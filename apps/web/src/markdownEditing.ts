import { type EditorState, type TransactionSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

export type MarkdownAction = "heading" | "bold" | "italic" | "inlineCode" | "list" | "ordered" | "quote" | "link";

/** Return one undoable edit, retaining the selected text for repeated formatting. */
export function markdownFormat(state: EditorState, action: MarkdownAction): TransactionSpec {
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  if (["heading", "list", "ordered", "quote"].includes(action)) {
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
    const lines = state.sliceDoc(first.from, last.to).split("\n");
    const prefix = action === "heading" ? "## " : action === "quote" ? "> " : "- ";
    const pattern = action === "heading" ? /^ {0,3}#{1,6}\s+/ : action === "quote" ? /^> / : action === "ordered" ? /^\d+\. / : /^[-+*] /;
    const remove = lines.every(line => pattern.test(line));
    const insert = lines.map((line, i) => remove ? line.replace(pattern, "") : (action === "ordered" ? String(i + 1) + ". " : prefix) + line.replace(pattern, "")).join("\n");
    return { changes: { from: first.from, to: last.to, insert }, selection: { anchor: first.from, head: first.from + insert.length }, userEvent: "input.format" };
  }
  if (action === "link") {
    const label = selected || "链接文字";
    const insert = "[" + label + "](https://)";
    return { changes: { from, to, insert }, selection: { anchor: from + label.length + 3, head: from + insert.length - 1 }, userEvent: "input.format" };
  }
  const marker = action === "bold" ? "**" : action === "italic" ? "*" : "`";
  const text = selected || (action === "inlineCode" ? "代码" : "文字");
  const enclosed = from >= marker.length && state.sliceDoc(from - marker.length, from) === marker && state.sliceDoc(to, to + marker.length) === marker;
  return enclosed ? {
    changes: { from: from - marker.length, to: to + marker.length, insert: selected },
    selection: { anchor: from - marker.length, head: to - marker.length }, userEvent: "input.format",
  } : {
    changes: { from, to, insert: marker + text + marker },
    selection: { anchor: from + marker.length, head: from + marker.length + text.length }, userEvent: "input.format",
  };
}

function decorations(view: EditorView): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const lines = new Map<number, Set<string>>();
  function lineClass(from: number, to: number, name: string) {
    for (let pos = view.state.doc.lineAt(from).from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const classes = lines.get(line.from) ?? new Set<string>();
      classes.add(name); lines.set(line.from, classes);
      if (line.to >= to || line.to === view.state.doc.length) break;
      pos = line.to + 1;
    }
  }
  syntaxTree(view.state).iterate({ enter(node) {
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
    if (heading) lineClass(node.from, node.to, "cm-md-heading cm-md-h" + heading[1]);
    if (node.name === "Blockquote") lineClass(node.from, node.to, "cm-md-quote");
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      lineClass(node.from, node.to, "cm-md-code"); return false;
    }
    if (node.name === "InlineCode") ranges.push(Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to));
    if (["HeaderMark", "QuoteMark", "ListMark", "EmphasisMark"].includes(node.name)) ranges.push(Decoration.mark({ class: "cm-md-mark" }).range(node.from, node.to));
  }});
  for (const [from, classes] of lines) ranges.push(Decoration.line({ class: [...classes].join(" ") }).range(from));
  return Decoration.set(ranges, true);
}

export const markdownAppearance = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorations(update.view);
  }
}, { decorations: value => value.decorations });
