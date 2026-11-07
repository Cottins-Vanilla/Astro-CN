import { markdownPresentation } from "../markdownPresentation";
import { clipboardMarkdown, fencedPaste } from "../markdownClipboard";
import { GFM } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorView, minimalSetup } from "codemirror";
import { NotePreview } from "./NotePreview";
import { CODE_LANGUAGES, codeBlockInsertion } from "../codeBlocks";
import { hiddenCodeFences } from "../codeFenceDisplay";
import { markdownAppearance, markdownFormat, type MarkdownAction } from "../markdownEditing";
import { keymap, lineNumbers, placeholder } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { parseWikiLinks, type LinkIndex } from "@solen/core";
import { useStore } from "../store";
import { usePanelMount } from "../usePanelMount";
import { solenEditorTheme, solenSyntaxHighlighting } from "../editorTheme";
import { loadLinkIndex } from "../linkIndex";
import { NotePicker } from "./NotePicker";

const externalBodyUpdate = Annotation.define<boolean>();

/** `[[` autocompletion listing existing note titles; selecting inserts `[[Title]]`. */
function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n]*/);
  if (!match) return null;
  if (match.from === match.to && !context.explicit) return null;

  const query = match.text.slice(2).toLowerCase();
  const alreadyClosed = context.state.sliceDoc(match.to, match.to + 2) === "]]";
  const titles = [...new Set(useStore.getState().noteList.map((n) => n.title))].sort((a, b) =>
    a.localeCompare(b),
  );
  const options = titles
    .filter((title) => title.toLowerCase().includes(query))
    .slice(0, 20)
    .map((title) => ({
      label: title,
      type: "text",
      apply(view: EditorView, _completion: unknown, from: number, to: number) {
        const insert = alreadyClosed ? title : `${title}]]`;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      },
    }));

  if (options.length === 0) return null;
  return { from: match.from + 2, options };
}

/**
 * `@` mention completion — the syntax-free entry point from
 * docs/DESIGN.md: typing `@` opens the same note list as `[[`, and picking
 * one consumes the `@query` and inserts a proper `[[Title]]` wiki-link.
 */
function atMentionCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/@[^\s[\]]*/);
  if (!match) return null;
  if (match.from === match.to && !context.explicit) return null;

  const query = match.text.slice(1).toLowerCase();
  const titles = [...new Set(useStore.getState().noteList.map((n) => n.title))].sort((a, b) =>
    a.localeCompare(b),
  );
  const options = titles
    .filter((title) => title.toLowerCase().includes(query))
    .slice(0, 20)
    .map((title) => ({
      label: title,
      type: "text",
      apply(view: EditorView, _completion: unknown, from: number, to: number) {
        const insert = `[[${title}]]`;
        // `from` here is one past the `@` (see the `+ 1` below, which keeps
        // CodeMirror's own label-matching from comparing "Ideas" against
        // the literal "@Idea"); go one further back to also delete the `@`
        // itself, so it's consumed rather than left behind.
        view.dispatch({ changes: { from: from - 1, to, insert }, selection: { anchor: from - 1 + insert.length } });
      },
    }));

  if (options.length === 0) return null;
  return { from: match.from + 1, options };
}

/** Ensure `[[Title]]` appears on the note's trailing "Links" section, adding one if needed. */
function appendConnection(body: string, title: string): string {
  const linkText = `[[${title}]]`;
  if (body.includes(linkText)) return body;
  const trimmed = body.replace(/\s+$/, "");
  const hasLinksHeading = /^#{1,3}\s*(?:Links|相关笔记)\s*$/m.test(trimmed);
  return hasLinksHeading ? `${trimmed}\n${linkText}\n` : `${trimmed}\n\n## 相关笔记\n${linkText}\n`;
}

/**
 * Floating panel (see App.tsx's .floating-dock): title input + CodeMirror
 * body editor for the note currently open (`store.openNoteId`). Frontmatter
 * (id/tags/timestamps) never appears here — only the body, per
 * docs/DATA-FORMAT.md. Below the editor, a connections strip surfaces
 * outgoing links and backlinks as clickable chips (docs/DESIGN.md's
 * syntax-free linking, paths 2 and 3).
 */
export function NoteEditor() {
  const openNoteId = useStore((s) => s.openNoteId);
  const note = useStore((s) => (s.openNoteId ? s.notes[s.openNoteId] : undefined));
  const noteList = useStore((s) => s.noteList);
  const closeEditor = useStore((s) => s.closeEditor);
  const updateNoteBody = useStore((s) => s.updateNoteBody);
  const updateNoteTitle = useStore((s) => s.updateNoteTitle);
  const openNote = useStore((s) => s.openNote);
  const openOrCreateNoteByTitle = useStore((s) => s.openOrCreateNoteByTitle);
  const pendingTitleFocusId = useStore((s) => s.pendingTitleFocusId);
  const clearTitleFocusRequest = useStore((s) => s.clearTitleFocusRequest);
  const lineNumbersOn = useStore((s) => s.lineNumbers);
  const readableLineLength = useStore((s) => s.readableLineLength);
  const editorFontSize = useStore((s) => s.editorFontSize);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const openNoteIdRef = useRef(openNoteId);
  openNoteIdRef.current = openNoteId;

  const [preview, setPreview] = useState(false);
  const [source, setSource] = useState(false);
  const presentation = useMemo(() => new Compartment(), []);
  const richPresentation = useMemo(() => [hiddenCodeFences, markdownAppearance, markdownPresentation(from => {
    setSource(true); setPreview(false);
    requestAnimationFrame(() => { const view = viewRef.current; if (view) { view.dispatch({ selection: { anchor: from }, scrollIntoView: true }); view.focus(); } });
  })], []);
  const [codeLanguage, setCodeLanguage] = useState("java");
  useEffect(() => { setPreview(false); setSource(false); }, [note?.id]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"insert" | "connect">("insert");
  const [linkIndex, setLinkIndex] = useState<LinkIndex | null>(null);

  // Keep the panel mounted through its exit animation (usePanelMount). Since
  // the editor's content is the open note, retain the last one so the card can
  // still render itself while it slides/fades out after `openNoteId` clears.
  const { mounted, visible } = usePanelMount(Boolean(openNoteId && note));
  const lastNoteRef = useRef(note);
  if (note) lastNoteRef.current = note;
  const displayNote = note ?? lastNoteRef.current;

  // (Re)create the CodeMirror view only when the *open note itself* changes,
  // not on every keystroke. External body changes are synchronized separately
  // so assistant inserts keep the existing editor, selection and undo history.
  useEffect(() => {
    if (!hostRef.current || !note) return;
    const id = note.id;
    const state = EditorState.create({
      doc: note.body,
      extensions: [
        minimalSetup,
        placeholder("开始写笔记…可使用 Markdown，或点击上方按钮设置标题、加粗和列表。"),
        EditorView.contentAttributes.of({ "aria-label": "笔记正文" }),
        EditorState.phrases.of({"Control character":"控制字符", "Loading...":"正在加载…", "No completions":"暂无补全建议", "Completions":"补全建议", "Fold line":"折叠这一段", "Unfold line":"展开这一段", "to":"到", "folded code":"已折叠的代码"}),
        EditorView.lineWrapping,
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        autocompletion({ override: [wikiLinkCompletions, atMentionCompletions] }),
        solenEditorTheme,
        solenSyntaxHighlighting,
        presentation.of(source ? [] : richPresentation),
        EditorView.domEventHandlers({ paste(event, view) {
          const data = event.clipboardData; if (!data) return false;
          const plain = data.getData("text/plain"); const html = data.getData("text/html");
          let node = syntaxTree(view.state).resolveInner(view.state.selection.main.from, -1);
          for (let parent = node; parent; parent = parent.parent!) {
            if (["FencedCode", "CodeBlock", "InlineCode"].includes(parent.name)) return false;
          }
          let insert: string;
          const vscode = data.getData("vscode-editor-data");
          if (vscode && plain) {
            let language = ""; try { const mode = JSON.parse(vscode).mode; language = typeof mode === "string" ? mode : ""; } catch {}
            insert = fencedPaste(plain, language);
          } else {
            if (!html) return false;
            insert = clipboardMarkdown(html, plain);
          }
          if (!insert) return false;
          event.preventDefault();
          const { from, to } = view.state.selection.main;
          // Block content pasted within a paragraph needs its own line boundaries.
          const block = /^(?:#{1,6} |`{3,}|[-*+] |\d+\. |>|\|)/.test(insert);
          const before = block && from > view.state.doc.lineAt(from).from ? "\n\n" : "";
          const after = block && to < view.state.doc.lineAt(to).to ? "\n\n" : "";
          view.dispatch({ ...view.state.replaceSelection(before + insert + after), userEvent: "input.paste", annotations: isolateHistory.of("full"), scrollIntoView: true });
          return true;
        } }),
        keymap.of([
          { key: "Mod-b", run: view => { view.dispatch(markdownFormat(view.state, "bold")); return true; } },
          { key: "Mod-i", run: view => { view.dispatch(markdownFormat(view.state, "italic")); return true; } },
        ]),
        // NoteEditor doesn't otherwise support reconfiguring a live view's extensions, so the
        // Settings modal's "Line numbers" toggle (SettingsModal.tsx) just goes through this
        // effect's own deps below — recreating the view is cheap enough for a settings change.
        ...(lineNumbersOn ? [lineNumbers()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && openNoteIdRef.current === id &&
              !update.transactions.some((tr) => tr.annotation(externalBodyUpdate))) {
            updateNoteBody(id, update.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // `mounted` is a dep (not just note.id): usePanelMount renders `null` for
    // the first frame after a note opens, so the host div — and thus
    // hostRef.current — only exists once `mounted` flips true. Without it this
    // effect would fire while the host is still absent, bail, and never re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on note.id + mounted + lineNumbersOn
  }, [note?.id, mounted, lineNumbersOn]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: presentation.reconfigure(source ? [] : richPresentation) });
  }, [source, mounted, note?.id, lineNumbersOn, presentation, richPresentation]);

  // Store changes from the assistant, connections or vault refresh must reach the
  // live editor. Local typing already matches, so it never dispatches a second edit.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !note) return;
    const previous = view.state.doc.toString();
    const next = note.body;
    if (previous === next) return;
    let from = 0;
    while (from < previous.length && from < next.length && previous[from] === next[from]) from++;
    let oldEnd = previous.length;
    let newEnd = next.length;
    while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === next[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    view.dispatch({
      changes: { from, to: oldEnd, insert: next.slice(from, newEnd) },
      annotations: [externalBodyUpdate.of(true), isolateHistory.of("full")],
      effects: EditorView.scrollIntoView(newEnd, { y: "nearest" }),
    });
  }, [note?.id, note?.body, mounted, lineNumbersOn]);

  // Full-vault link index for backlinks — refreshed whenever a different
  // note is opened (see docs/linkIndex.ts for why this isn't recomputed on
  // every keystroke).
  useEffect(() => {
    if (!note) return;
    let cancelled = false;
    void loadLinkIndex().then((idx) => {
      if (!cancelled) setLinkIndex(idx);
    });
    return () => {
      cancelled = true;
    };
  }, [note?.id]);

  // A note the 3D graph just created (double-click / shift-drag-to-empty) asks for its title
  // input to be focused the moment the editor opens on it — see docs/WORKSPACE-3D.md.
  useEffect(() => {
    if (!note || pendingTitleFocusId !== note.id) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
    clearTitleFocusRequest();
  }, [note, pendingTitleFocusId, clearTitleFocusRequest]);

  useEffect(() => {
    if (!openNoteId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeEditor();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setPickerMode("insert");
        setPickerOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openNoteId, closeEditor]);

  const knownTitles = useMemo(() => new Map(noteList.map((n) => [n.title.toLowerCase(), n])), [noteList]);

  const outgoing = useMemo(() => {
    if (!note) return [];
    const seen = new Set<string>();
    const links: { title: string; id?: string; ghost: boolean }[] = [];
    for (const link of parseWikiLinks(note.body)) {
      const key = link.target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = knownTitles.get(key);
      links.push({ title: link.target, id: resolved?.id, ghost: !resolved });
    }
    return links;
  }, [note, knownTitles]);

  const backlinks = useMemo(() => {
    if (!note || !linkIndex) return [];
    const titleById = new Map(linkIndex.nodes.map((n) => [n.id, n.title]));
    const fromIds = new Set(
      linkIndex.edges.filter((e) => e.to === note.id && e.from !== note.id).map((e) => e.from),
    );
    return [...fromIds].map((id) => ({ id, title: titleById.get(id) ?? "未命名" }));
  }, [note, linkIndex]);

  function insertLinkAtCursor(title: string) {
    const view = viewRef.current;
    if (!view) return;
    const insert = `[[${title}]]`;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    view.focus();
  }

  function insertCode() {
    const view = viewRef.current;
    if (!view) return;
    setPreview(false);
    const { from, to } = view.state.selection.main;
    const { insert, anchor } = codeBlockInsertion(view.state.doc.toString(), from, to, codeLanguage);
    view.dispatch({ changes: { from, to, insert }, selection: { anchor } });
    requestAnimationFrame(() => view.focus());
  }

  function formatMarkdown(action: MarkdownAction) {
    const view = viewRef.current;
    if (!view) return;
    setPreview(false);
    if (action === "link") setSource(true);
    view.dispatch(markdownFormat(view.state, action));
    requestAnimationFrame(() => view.focus());
  }

  function handleConnect(title: string) {
    if (!note) return;
    updateNoteBody(note.id, appendConnection(note.body, title));
  }

  if (!mounted || !displayNote) return null;

  return (
    <div className={`floating-panel editor-panel ${visible ? "panel-open" : "panel-closed"}`}>
      <div className="dock-panel-header">
        <input
          ref={titleInputRef}
          value={displayNote.title}
          onChange={(e) => updateNoteTitle(displayNote.id, e.target.value)}
          placeholder="未命名"
          className="flex-1 min-w-0 bg-transparent text-sm font-medium normal-case tracking-normal outline-none text-[var(--color-text)]"
          style={{ fontFamily: "var(--font-body)" }}
        />
        <button
          onClick={() => {
            setPickerMode("insert");
            setPickerOpen(true);
          }}
          title="插入笔记链接（Ctrl+L）"
          className="link-toolbar-btn nodrag"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M9 15 L15 9" />
            <path d="M13 6.5 L15.5 4 a4 4 0 0 1 5.5 5.5 L18.5 12" />
            <path d="M11 17.5 L8.5 20 a4 4 0 0 1 -5.5 -5.5 L5.5 12" />
          </svg>
        </button>
        <button
          onClick={closeEditor}
          title="关闭（Esc）"
          className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-base leading-none px-1"
        >
          ×
        </button>
      </div>
      <div className="note-format-toolbar">
        <div className="note-mode-buttons" role="group" aria-label="笔记显示方式">
          <button type="button" aria-pressed={!preview && !source} onClick={() => { setSource(false); setPreview(false); }}>编辑</button>
          <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>预览</button>
          <button type="button" aria-pressed={!preview && source} onClick={() => { setSource(true); setPreview(false); }} title="查看和修改 Markdown 标记">源码</button>
        </div>
        <label>代码语言
          <select aria-label="代码语言" value={codeLanguage} onChange={e => setCodeLanguage(e.target.value)}>
            {CODE_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={insertCode} title="将选中的内容转为代码块，或插入一个空代码块">插入代码</button>
      </div>
      <div className="note-markdown-toolbar" role="toolbar" aria-label="Markdown 格式">
        {([ ["heading", "标题", "设置标题"], ["bold", "加粗", "加粗（Ctrl+B）"], ["italic", "斜体", "斜体（Ctrl+I）"], ["list", "列表", "无序列表"], ["ordered", "编号", "有序列表"], ["quote", "引用", "引用段落"], ["inlineCode", "行内代码", "设置行内代码"], ["link", "链接", "插入网页链接"] ] as const).map(([action, label, title]) =>
          <button key={action} type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={() => formatMarkdown(action)}>{label}</button>
        )}
        <span>{source ? "Markdown 源码" : "保留粘贴格式"} · 自动保存</span>
      </div>
      {preview && <NotePreview body={displayNote.body} />}
      {/* Font size rides on a CSS custom property rather than a CodeMirror theme extension, so
          changing it never has to tear down and rebuild the view (see the effect above). */}
      <div
        ref={hostRef}
        className={`flex-1 min-h-0 overflow-auto ${readableLineLength ? "editor-readable-width" : ""}`}
        style={{ "--editor-font-size": `${editorFontSize}px`, display: preview ? "none" : undefined } as CSSProperties}
      />

      <div className="connections-strip">
        <div className="connections-row">
          <span className="connections-label">相关笔记</span>
          {outgoing.map((link) => (
            <button
              key={link.title}
              className={`connection-chip ${link.ghost ? "ghost" : ""}`}
              onClick={() => void openOrCreateNoteByTitle(link.title)}
            >
              {link.title}
            </button>
          ))}
          <button
            className="connection-chip connect"
            onClick={() => {
              setPickerMode("connect");
              setPickerOpen(true);
            }}
          >
            + 添加关联
          </button>
        </div>
        {backlinks.length > 0 && (
          <div className="connections-row">
            <span className="connections-label">哪些笔记提到了这里</span>
            {backlinks.map((b) => (
              <button key={b.id} className="connection-chip" onClick={() => void openNote(b.id)}>
                {b.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <NotePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(title) => {
          // Ctrl+L / the toolbar button insert at the cursor; the
          // connections strip's "+ Connect" appends to a trailing "Links"
          // section instead. Both converge on the same `[[Title]]` syntax.
          if (pickerMode === "connect") handleConnect(title);
          else insertLinkAtCursor(title);
        }}
      />
    </div>
  );
}



