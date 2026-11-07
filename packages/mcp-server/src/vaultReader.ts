import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  filenameForTitle,
  parseNote,
  serializeNote,
  type CanvasDoc,
  type CanvasMeta,
  type Note,
  type NoteMeta,
  type VaultFileNode,
} from "@solen/core";

const NOTE_EXT = ".md";
const CANVAS_EXT = ".scanvas";
const ASTRO_SUBDIR = ".astro";

/**
 * Filesystem vault reader/writer for the MCP server: reads fresh from disk
 * on every call rather than caching, per docs/DATA-FORMAT.md's directory
 * layout (`<vaultDir>/.astro/{notes,canvases}`, filenames mirroring titles —
 * see docs/ARCH-VAULT-STORAGE.md). Vaults are small, so simplicity wins over
 * watching or indexing; this stays a stateless mirror of
 * apps/desktop/src/filesystemVault.ts rather than keeping its own id→filename
 * map across calls.
 */

function notesDir(vaultDir: string): string {
  return path.join(vaultDir, ASTRO_SUBDIR, "notes");
}

function canvasesDir(vaultDir: string): string {
  return path.join(vaultDir, ASTRO_SUBDIR, "canvases");
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Recursively lists file paths under `dir` ending in `ext`, relative to `dir` and always
 * POSIX-separated — mirrors filesystemVault.ts's `walkFiles`. */
async function walkFiles(dir: string, ext: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await walkFiles(path.join(dir, entry.name), ext);
      out.push(...nested.map((p) => `${entry.name}/${p}`));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      out.push(entry.name);
    }
  }
  return out;
}

function folderOf(relPath: string): string | undefined {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? undefined : relPath.slice(0, i);
}

export async function readAllNotes(vaultDir: string): Promise<Note[]> {
  const dir = notesDir(vaultDir);
  const relPaths = await walkFiles(dir, NOTE_EXT);
  return Promise.all(
    relPaths.map(async (relPath) => {
      const fallbackId = path.basename(relPath, NOTE_EXT);
      const raw = await readFile(path.join(dir, ...relPath.split("/")), "utf8");
      return { ...parseNote(fallbackId, raw), folder: folderOf(relPath) };
    }),
  );
}

export async function readAllCanvases(vaultDir: string): Promise<CanvasDoc[]> {
  const dir = canvasesDir(vaultDir);
  const files = await listFiles(dir, CANVAS_EXT);
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(dir, file), "utf8");
      return JSON.parse(raw) as CanvasDoc;
    }),
  );
}

/** Writes a note, renaming its file to mirror its (possibly changed) title/folder — the same
 * filename-derivation `filesystemVault.ts` uses, so a note the MCP server touches stays
 * consistent with one the app touches. Looks up the note's current file (if any) by scanning for
 * its id, since this reader keeps no long-lived id→filename map across calls. */
export async function writeNoteFile(vaultDir: string, note: Note): Promise<void> {
  const dir = notesDir(vaultDir);
  const relPaths = await walkFiles(dir, NOTE_EXT);

  let currentRelPath: string | undefined;
  const others: string[] = [];
  for (const relPath of relPaths) {
    const raw = await readFile(path.join(dir, ...relPath.split("/")), "utf8");
    const existing = parseNote(path.basename(relPath, NOTE_EXT), raw);
    if (existing.id === note.id) currentRelPath = relPath;
    else others.push(relPath);
  }

  const targetFolder = note.folder ?? folderOf(currentRelPath ?? "");
  const takenInFolder = new Set(
    others.filter((relPath) => folderOf(relPath) === targetFolder).map((relPath) => path.basename(relPath).toLowerCase()),
  );
  const filename = filenameForTitle(note.title, note.id, NOTE_EXT, takenInFolder);
  const desiredRelPath = targetFolder ? `${targetFolder}/${filename}` : filename;
  const newFullPath = path.join(dir, ...desiredRelPath.split("/"));

  await mkdir(path.dirname(newFullPath), { recursive: true });
  if (currentRelPath !== undefined && currentRelPath !== desiredRelPath) {
    await rename(path.join(dir, ...currentRelPath.split("/")), newFullPath);
  }
  await writeFile(newFullPath, serializeNote(note), "utf8");
}

/** Extensions treated as binary — never read as text for the vault file graph's "mentions"
 * cross-referencing (garbage bytes decoded as UTF-8 would produce meaningless matches). Every
 * other extension (including unknown ones) is tried as text; a decode failure is caught and
 * skipped per-file rather than maintained as an ever-growing allowlist. */
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".flac", ".ogg",
  ".pdf", ".zip", ".7z", ".rar", ".tar", ".gz",
  ".exe", ".dll", ".bin", ".woff", ".woff2", ".ttf", ".otf",
]);

/** Directories never descended into: version-control internals and dependency trees aren't vault
 * content, and walking them in full (`node_modules` especially) can make this tool's cost
 * unbounded if the vault happens to be a checked-out repo. */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Hard ceiling on how many nodes `readVaultFileTree` collects — a runaway-size guard, not an
 * expected vault size. `get_vault_file_graph`'s "mentions" pass is O(files × text files), so an
 * unbounded tree is the real risk (see `SKIP_DIRS` above for the common case that trips this). */
const MAX_NODES = 20_000;

/** Walks the *entire* vault folder (not just `.astro/notes`) — every file and directory, any
 * type — for the `get_vault_file_graph` MCP tool. See docs/ARCH-VAULT-STORAGE.md: root-level
 * files outside `.astro/` are the user's own, not Astro notes, but they're exactly the substrate
 * this tool turns into a graph. */
export async function readVaultFileTree(vaultDir: string): Promise<VaultFileNode[]> {
  const nodes: VaultFileNode[] = [];

  async function walk(dir: string, relPrefix: string): Promise<void> {
    if (nodes.length >= MAX_NODES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (nodes.length >= MAX_NODES) return;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const id = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      const info = await stat(fullPath);
      const ext = entry.isDirectory() ? "" : path.extname(entry.name).toLowerCase();
      nodes.push({
        id,
        name: entry.name,
        ext,
        isDir: entry.isDirectory(),
        size: info.size,
        updatedAt: info.mtime.toISOString(),
      });
      if (entry.isDirectory()) await walk(fullPath, id);
    }
  }

  await walk(vaultDir, "");
  return nodes;
}

/** Reads every non-binary file's content, keyed by the same id `readVaultFileTree` used — the
 * cross-reference ("mentions") half of the vault file graph. A decode failure (a binary file we
 * didn't recognize by extension) is skipped, not thrown — one unreadable file shouldn't fail the
 * whole graph. */
const MAX_TEXT_SCAN_BYTES = 2_000_000;

export async function readVaultTextContents(vaultDir: string, nodes: VaultFileNode[]): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  for (const node of nodes) {
    if (node.isDir || BINARY_EXTS.has(node.ext) || node.size > MAX_TEXT_SCAN_BYTES) continue;
    try {
      contents.set(node.id, await readFile(path.join(vaultDir, ...node.id.split("/")), "utf8"));
    } catch {
      // Unreadable or not actually valid UTF-8 — skip, the node itself is still in the graph.
    }
  }
  return contents;
}

export function toNoteMeta(note: Note): NoteMeta {
  const { id, title, tags, createdAt, updatedAt, folder } = note;
  return { id, title, tags, createdAt, updatedAt, folder };
}

export function toCanvasMeta(canvas: CanvasDoc): CanvasMeta {
  const { id, name, createdAt, updatedAt } = canvas;
  return { id, name, createdAt, updatedAt };
}
