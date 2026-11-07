import type { Note } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Strips a leading UTF-8 BOM (`﻿`) — Windows editors (historically Notepad, still some
 * others) can prepend one, and without stripping it the frontmatter regex below never matches,
 * silently treating a perfectly normal note as body-only content. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Serialize a Note to CommonMark with a YAML frontmatter block, per
 * docs/DATA-FORMAT.md. Hand-rolled — only the fields Solen notes use.
 */
export function serializeNote(note: Note): string {
  const lines = [
    "---",
    `id: ${note.id}`,
    `title: ${yamlScalar(note.title)}`,
    `tags: [${note.tags.map(yamlScalar).join(", ")}]`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    "---",
    "",
  ];
  return lines.join("\n") + note.body;
}

/** Parse a Markdown-with-frontmatter file back into a Note. */
/**
 * `fallbackTitle` exists because the identity a note falls back to and the name it shows are not
 * the same thing once notes can share a name. An imported Obsidian vault has one `Status.md` per
 * project: keying identity on the filename alone made them all the same note and silently dropped
 * every copy but the last, so the caller passes a per-file unique `id` (the vault-relative path)
 * while still showing the plain filename as the title. Defaults to `id`, which is what every
 * caller that has no such distinction to make was relying on.
 */
export function parseNote(id: string, raw: string, fallbackTitle: string = id): Note {
  const stripped = stripBom(raw);
  const match = stripped.match(FRONTMATTER_RE);
  if (!match) {
    return { id, title: fallbackTitle, tags: [], createdAt: "", updatedAt: "", body: stripped };
  }
  const [, block, body] = match;
  const fields = parseYamlBlock(block);
  return {
    id: String(fields.id ?? id),
    title: String(fields.title ?? fallbackTitle),
    tags: Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
    createdAt: String(fields.createdAt ?? ""),
    updatedAt: String(fields.updatedAt ?? ""),
    body,
  };
}

/** Parse the small subset of YAML used by note frontmatter: `key: value` and `key: [a, b]`. */
function parseYamlBlock(block: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    fields[key] = parseYamlScalarOrArray(rawValue.trim());
  }
  return fields;
}

function parseYamlScalarOrArray(value: string): unknown {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((v) => unquote(v.trim()));
  }
  return unquote(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Quote a YAML scalar only when needed (contains punctuation YAML treats specially). */
function yamlScalar(value: string): string {
  if (/^[\w .-]*$/.test(value) && value.length > 0) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
