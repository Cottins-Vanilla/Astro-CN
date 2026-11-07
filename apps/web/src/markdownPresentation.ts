import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { parser, GFM } from "@lezer/markdown";
import { marked } from "marked";
import DOMPurify from "dompurify";

const richParser = parser.configure(GFM);
export interface MarkdownHiddenRange { from: number; to: number; text?: string; kind?: "task" | "table" | "rule"; checked?: boolean }

/** Only hide parsed markup; characters inside code remain literal. */
export function markdownHiddenRanges(doc: string): MarkdownHiddenRange[] {
  const ranges: MarkdownHiddenRange[] = [];
  const tree = richParser.parse(doc);
  tree.iterate({ enter(node) {
    if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name)) return false;
    if (node.name === "Table") { ranges.push({ from: node.from, to: node.to, kind: "table" }); return false; }
    if (node.name === "HorizontalRule") { ranges.push({ from: node.from, to: node.to, kind: "rule" }); return false; }
    if (["HeaderMark", "QuoteMark"].includes(node.name)) {
      let to = node.to;
      while (to < doc.length && /[ \t]/.test(doc[to])) to++;
      ranges.push({ from: node.from, to });
    }
    if (["EmphasisMark", "StrikethroughMark", "CodeMark"].includes(node.name)) ranges.push({ from: node.from, to: node.to });
    if (node.name === "Escape") ranges.push({ from: node.from, to: node.from + 1 });
    if (node.name === "ListMark") {
      let to = node.to; while (/[ \t]/.test(doc[to] ?? "" ) && to < doc.length) to++;
      const mark = doc.slice(node.from, node.to);
      ranges.push({ from: node.from, to, text: /^\d/.test(mark) ? mark : "•" });
    }
    if (node.name === "TaskMarker") ranges.push({ from: node.from, to: node.to, kind: "task", checked: /x/i.test(doc.slice(node.from, node.to)) });
    if (node.name === "Link") {
      const url = node.node.getChild("URL");
      if (url && doc[node.from] === "[") {
        const labelEnd = doc.lastIndexOf("]", url.from);
        if (labelEnd > node.from) {
          ranges.push({ from: node.from, to: node.from + 1 }, { from: labelEnd, to: node.to });
          // Keep emphasis inside the link label without treating the destination as text.
        }
      }
    }
  }});
  return ranges.sort((a, b) => a.from - b.from || b.to - a.to).filter((range, i, all) => !all.slice(0, i).some(prev => prev.from <= range.from && prev.to >= range.to));
}

class MarkdownWidget extends WidgetType {
  constructor(readonly range: MarkdownHiddenRange, readonly source: string, readonly editSource: (from: number) => void) { super(); }
  eq(other: MarkdownWidget) { return JSON.stringify(this.range) === JSON.stringify(other.range) && this.source === other.source; }
  toDOM(view: EditorView) {
    const { kind, text, checked, from, to } = this.range;
    if (kind === "table") {
      const root = document.createElement("div"); root.className = "cm-md-rendered-table markdown-body";
      const button = document.createElement("button"); button.type = "button"; button.textContent = "编辑表格"; button.onclick = () => this.editSource(from);
      const body = document.createElement("div"); body.innerHTML = DOMPurify.sanitize(marked.parse(this.source, { async: false, gfm: true }));
      root.append(button, body); return root;
    }
    if (kind === "rule") { const el = document.createElement("hr"); el.className = "cm-md-rule"; return el; }
    if (kind === "task") {
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!checked; input.className = "cm-md-task"; input.setAttribute("aria-label", "标记任务完成");
      input.onchange = () => view.dispatch({ changes: { from, to, insert: input.checked ? "[x]" : "[ ]" }, userEvent: "input.task" });
      return input;
    }
    const span = document.createElement("span"); span.className = "cm-md-list-bullet"; span.textContent = text ?? ""; return span;
  }
}

export function markdownPresentation(editSource: (from: number) => void) {
  function build(state: EditorState): DecorationSet {
    const doc = state.doc.toString();
    return Decoration.set(markdownHiddenRanges(doc).map(range => Decoration.replace({
      ...(range.text || range.kind ? { widget: new MarkdownWidget(range, doc.slice(range.from, range.to), editSource) } : {}),
      block: range.kind === "table" || range.kind === "rule", inclusive: false,
    }).range(range.from, range.to)), true);
  }
  const field = StateField.define<DecorationSet>({
    create: build, update: (value, tr) => tr.docChanged ? build(tr.state) : value,
    provide: value => [EditorView.decorations.from(value), EditorView.atomicRanges.of(view => view.state.field(value))],
  });
  return field;
}
