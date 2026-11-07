import { Prec, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";

interface FenceLine { from: number; to: number; after: number }
export interface CodeFenceBlock {
  opening: FenceLine;
  closing?: FenceLine;
  language: string;
  bodyFrom: number;
  bodyTo: number;
}

/** Parse only real line fences. A shorter fence inside code remains ordinary code. */
export function codeFenceBlocks(doc: string): CodeFenceBlock[] {
  const blocks: CodeFenceBlock[] = [];
  let active: { block: CodeFenceBlock; marker: string; length: number } | undefined;
  let offset = 0;
  for (const line of doc.split("\n")) {
    const range = { from: offset, to: offset + line.length, after: Math.min(doc.length, offset + line.length + 1) };
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match && active) {
      if (match[1][0] === active.marker && match[1].length >= active.length && !match[2].trim()) {
        active.block.closing = range;
        active.block.bodyTo = Math.max(active.block.bodyFrom, range.from - 1);
        blocks.push(active.block);
        active = undefined;
      }
    } else if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
      active = {
        marker: match[1][0], length: match[1].length,
        block: { opening: range, language: match[2].trim().split(/\s+/)[0], bodyFrom: range.after, bodyTo: doc.length },
      };
    }
    offset = range.after;
  }
  if (active) blocks.push(active.block);
  return blocks;
}

class CodeLanguageLabel extends WidgetType {
  constructor(readonly language: string) { super(); }
  eq(other: CodeLanguageLabel) { return this.language === other.language; }
  toDOM() {
    const label = document.createElement("div");
    label.className = "cm-code-language-label";
    label.textContent = this.language || "代码";
    label.setAttribute("aria-label", "代码块语言");
    return label;
  }
}

function buildDisplay(state: EditorState) {
  const blocks = codeFenceBlocks(state.doc.toString());
  const ranges = blocks.flatMap(block => {
    const opening = Decoration.replace({ block: true, widget: new CodeLanguageLabel(block.language), inclusive: false })
      .range(block.opening.from, block.opening.after);
    return block.closing
      ? [opening, Decoration.replace({ block: true, inclusive: false }).range(block.closing.from, block.closing.after)]
      : [opening];
  });
  return { blocks, decorations: Decoration.set(ranges, true) };
}

const fenceDisplay = StateField.define<{ blocks: CodeFenceBlock[]; decorations: DecorationSet }>({
  create: buildDisplay,
  update: (value, tr) => tr.docChanged ? buildDisplay(tr.state) : value,
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).decorations),
  ],
});

/** Keep ordinary boundary deletion from eating an invisible fence. Full selections still delete. */
function protectBoundary(view: EditorView, backward: boolean): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  return view.state.field(fenceDisplay).blocks.some(block => backward
    ? selection.head === block.bodyFrom || selection.head === block.closing?.after
    : !!block.closing && selection.head === block.bodyTo);
}

export const hiddenCodeFences = [fenceDisplay, Prec.highest(keymap.of([
  { key: "Backspace", run: view => protectBoundary(view, true) },
  { key: "Mod-Backspace", run: view => protectBoundary(view, true) },
  { key: "Delete", run: view => protectBoundary(view, false) },
  { key: "Mod-Delete", run: view => protectBoundary(view, false) },
]))];
