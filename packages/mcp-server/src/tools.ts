import {
  buildLinkIndex,
  buildVaultFileGraph,
  newNoteId,
  parseInlineTags,
  type CanvasDoc,
  type CanvasMeta,
  type LinkIndex,
  type Note,
  type NoteMeta,
  type VaultFileGraph,
} from "@solen/core";
import {
  readAllCanvases,
  readAllNotes,
  readVaultFileTree,
  readVaultTextContents,
  toCanvasMeta,
  toNoteMeta,
  writeNoteFile,
} from "./vaultReader.js";

/**
 * Plain, stdio-agnostic tool implementations. `server.ts` wraps each of
 * these in an MCP `registerTool` call; tests exercise them directly against
 * a fixture vault directory without spinning up a transport.
 */

export async function listNotesTool(vaultDir: string): Promise<NoteMeta[]> {
  const notes = await readAllNotes(vaultDir);
  return notes.map(toNoteMeta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface ReadNoteQuery {
  id?: string;
  title?: string;
}

export async function readNoteTool(vaultDir: string, query: ReadNoteQuery): Promise<Note> {
  const notes = await readAllNotes(vaultDir);
  const note = query.id
    ? notes.find((n) => n.id === query.id)
    : notes.find((n) => n.title.toLowerCase() === (query.title ?? "").toLowerCase());
  if (!note) {
    throw new Error(`Note not found for ${query.id ? `id "${query.id}"` : `title "${query.title ?? ""}"`}.`);
  }
  return note;
}

export interface SearchMatch {
  id: string;
  title: string;
  /** Up to one line of context above and below the matching line (or the title, for a title-only match). */
  snippet: string;
}

/** Case-insensitive substring search over title + body, per note. */
export async function searchNotesTool(vaultDir: string, query: string): Promise<SearchMatch[]> {
  const q = query.toLowerCase();
  if (!q) return [];
  const notes = await readAllNotes(vaultDir);
  const results: SearchMatch[] = [];

  for (const note of notes) {
    const lines = note.body.split("\n");
    const hitIndex = lines.findIndex((line) => line.toLowerCase().includes(q));
    const titleHit = note.title.toLowerCase().includes(q);
    if (hitIndex === -1 && !titleHit) continue;

    const snippet =
      hitIndex === -1
        ? note.title
        : lines
            .slice(Math.max(0, hitIndex - 1), hitIndex + 2)
            .join("\n")
            .trim();
    results.push({ id: note.id, title: note.title, snippet });
  }
  return results;
}

export interface WriteNoteInput {
  title: string;
  body: string;
  /** Update an existing note by id; omit to create a new note. */
  id?: string;
}

/** Create a new note, or update an existing one by id, and persist it to disk. */
export async function writeNoteTool(vaultDir: string, input: WriteNoteInput): Promise<Note> {
  const now = new Date().toISOString();

  if (input.id) {
    const notes = await readAllNotes(vaultDir);
    const existing = notes.find((n) => n.id === input.id);
    if (!existing) throw new Error(`Note not found: ${input.id}`);
    const updated: Note = {
      ...existing,
      title: input.title,
      body: input.body,
      tags: parseInlineTags(input.body),
      updatedAt: now,
    };
    await writeNoteFile(vaultDir, updated);
    return updated;
  }

  const note: Note = {
    id: newNoteId(),
    title: input.title,
    tags: parseInlineTags(input.body),
    createdAt: now,
    updatedAt: now,
    body: input.body,
  };
  await writeNoteFile(vaultDir, note);
  return note;
}

export async function listCanvasesTool(vaultDir: string): Promise<CanvasMeta[]> {
  const canvases = await readAllCanvases(vaultDir);
  return canvases.map(toCanvasMeta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface ReadCanvasQuery {
  id?: string;
  name?: string;
}

export async function readCanvasTool(vaultDir: string, query: ReadCanvasQuery): Promise<CanvasDoc> {
  const canvases = await readAllCanvases(vaultDir);
  const canvas = query.id
    ? canvases.find((c) => c.id === query.id)
    : canvases.find((c) => c.name.toLowerCase() === (query.name ?? "").toLowerCase());
  if (!canvas) {
    throw new Error(`Canvas not found for ${query.id ? `id "${query.id}"` : `name "${query.name ?? ""}"`}.`);
  }
  return canvas;
}

/** The knowledge graph — derived from wiki-links and canvas edges, per docs/DATA-FORMAT.md. */
export async function getGraphTool(vaultDir: string): Promise<LinkIndex> {
  const [notes, canvases] = await Promise.all([readAllNotes(vaultDir), readAllCanvases(vaultDir)]);
  return buildLinkIndex(notes, canvases);
}

/** The whole-vault file graph — every file and folder in the vault (any type, not just Astro
 * notes), connected by folder containment and by one file's text mentioning another's name. See
 * packages/core/src/vaultGraph.ts and docs/ARCH-VAULT-STORAGE.md's graphify research: this is a
 * lighter, dependency-free take on "turn a folder of arbitrary files into a queryable graph." */
export async function getVaultFileGraphTool(vaultDir: string): Promise<VaultFileGraph> {
  const nodes = await readVaultFileTree(vaultDir);
  const textContents = await readVaultTextContents(vaultDir, nodes);
  return buildVaultFileGraph(nodes, textContents);
}
