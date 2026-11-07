import { EditorView } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Shared, theme-aware palette for editing and preview. Colors come from index.css. */
export const solenSyntaxHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  { tag: [tags.comment, tags.meta], color: "var(--code-comment)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--code-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: "var(--code-type)" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--code-operator)" },
  { tag: [tags.regexp, tags.escape], color: "var(--code-number)" },
  { tag: tags.heading, color: "var(--color-text)", fontWeight: "600" },
  { tag: tags.link, color: "var(--code-function)", textDecoration: "underline" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
]));

/**
 * Minimal CodeMirror 6 theme mapped onto the app's CSS custom properties
 * (see index.css) so the editor matches whichever theme is active — no
 * third-party theme package.
 */
export const solenEditorTheme = EditorView.theme({
  "&": {
    color: "var(--code-text)",
    backgroundColor: "var(--color-surface)",
    height: "100%",
    fontSize: "0.875rem",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-content": {
    caretColor: "var(--color-accent)",
    fontFamily: "var(--font-body)",
    // Settings → Editor → Font size sets `--editor-font-size` on the host div (NoteEditor.tsx);
    // the fallback keeps every other CodeMirror mount at the size it always had.
    fontSize: "var(--editor-font-size, var(--text-md))",
    lineHeight: "1.6",
    padding: "0.75rem",
  },
  ".cm-line": {
    padding: "0 0.1rem",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--color-accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--color-surface-2)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    color: "var(--code-text)",
    borderRadius: "0.5rem",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "0.2rem 0.5rem",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-contrast)",
  },
  ".cm-placeholder": {
    color: "var(--color-muted)",
  },
});

