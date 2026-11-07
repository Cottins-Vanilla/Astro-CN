import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { solenEditorTheme, solenSyntaxHighlighting } from "../editorTheme";
export function NotePreview({ body }: { body: string }) {
 const host = useRef<HTMLDivElement>(null);
 useEffect(() => {
  const root = host.current;
  if (!root) return;
  root.innerHTML = DOMPurify.sanitize(marked.parse(body, { async: false, gfm: true }));
  let cancelled = false;
  const views: EditorView[] = [];
  for (const code of root.querySelectorAll("pre > code")) {
   const pre = code.parentElement!;
   const text = code.textContent?.replace(/\n$/, "") ?? "";
   const language = [...code.classList].find(c => c.startsWith("language-"))?.slice(9) ?? "";
   const block = document.createElement("section"); block.className = "note-code-block";
   const header = document.createElement("div"); header.className = "note-code-header";
   const label = document.createElement("span"); label.textContent = language || "普通文本";
   const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "复制代码";
   copy.onclick = () => { void navigator.clipboard.writeText(text).then(() => { if (!cancelled) copy.textContent = "已复制"; }).catch(() => { if (!cancelled) copy.textContent = "复制失败，请手动选择复制"; }); };
   header.append(label, copy);
   const target = document.createElement("div"); block.append(header, target); pre.replaceWith(block);
   const description = LanguageDescription.matchLanguageName(languages, language, true);
   void (async () => {
    const support = description ? await description.load().catch(() => null) : null;
    if (cancelled) return;
    views.push(new EditorView({ parent: target, state: EditorState.create({ doc: text, extensions: [
     EditorState.readOnly.of(true), EditorView.editable.of(false),
     EditorView.contentAttributes.of({ "aria-label": "代码预览" }), lineNumbers(), solenEditorTheme,
     solenSyntaxHighlighting, ...(support ? [support] : []),
    ] }) }));
   })();
  }
  return () => { cancelled = true; views.forEach(view => view.destroy()); };
 }, [body]);
 return <div ref={host} className="markdown-body note-preview" aria-label="笔记预览" />;
}

