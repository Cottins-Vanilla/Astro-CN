import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  filenameForTitle,
  newNoteId,
  parseNote,
  sanitizeTitle,
  serializeNote,
  stripBom,
  type CanvasDoc,
  type CanvasMeta,
  type Note,
  type NoteMeta,
  type VaultAdapter,
  type VaultMeta,
} from "@solen/core";

const NOTE_EXT = ".md";
const CANVAS_EXT = ".scanvas";
const VAULT_META_FILE = "vault.json";
const ASTRO_SUBDIR = ".astro";

/** Lists file names directly under `dir` ending in `ext`, per the directory
 * layout in docs/DATA-FORMAT.md. Mirrors packages/mcp-server/src/vaultReader.ts's
 * `listFiles` — a missing directory (a brand-new vault with no notes/canvases
 * yet) is simply an empty list, not an error. */
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
 * POSIX-separated (`research/Idea.md`) regardless of platform — this becomes both the on-disk
 * path (joined back with `path.join`) and the note's `folder` (its dirname). */
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Writes `contents` to `filePath` atomically: write to a sibling temp file,
 * then `rename` over the target. `rename` within the same directory is an
 * atomic filesystem operation on every platform Electron targets, so a crash
 * (or a second write racing this one) never leaves a half-written
 * note/canvas/`vault.json` on disk — readers either see the old file or the
 * fully-written new one, never a partial one. Creates the containing
 * directory (e.g. `notes/`, `canvases/`) if it doesn't exist yet. */
async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmpPath, contents, "utf8");
  await rename(tmpPath, filePath);
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function toNoteMeta(note: Note): NoteMeta {
  const { id, title, tags, createdAt, updatedAt, folder } = note;
  return { id, title, tags, createdAt, updatedAt, folder };
}

function toCanvasMeta(canvas: CanvasDoc): CanvasMeta {
  const { id, name, createdAt, updatedAt } = canvas;
  return { id, name, createdAt, updatedAt };
}

/** dirname of a POSIX relPath, `undefined` at the root ("Idea.md" -> undefined,
 * "research/Idea.md" -> "research"). */
function folderOf(relPath: string): string | undefined {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? undefined : relPath.slice(0, i);
}

/**
 * Node-only `VaultAdapter` backed by real files on a user-chosen folder, per
 * docs/DATA-FORMAT.md's directory layout: `<vaultDir>/.astro/{vault.json,notes/,canvases/}`.
 * Used by the Electron main process (apps/desktop/src/main.ts) via IPC — never imported by the
 * browser bundle, since it depends on `node:fs/promises`. Every write is atomic (temp file +
 * rename, see `atomicWriteFile`).
 *
 * Filenames mirror note titles (see docs/ARCH-VAULT-STORAGE.md) — the note's stable identity is
 * its frontmatter `id`, never the filename, so an id→relPath map (`this.noteFiles`) is the source
 * of truth for "where does note X live right now." Rebuilt by a full recursive scan
 * (`rescanNotes`) — vaults are small, so a scan per session/focus is simplicity-over-indexing,
 * matching this adapter's existing no-watcher stance.
 */
export class FilesystemVaultAdapter implements VaultAdapter {
  /** id -> POSIX relPath under notesDir(), e.g. "research/Idea.md". Lazily built; `undefined`
   * means "never scanned yet this session." */
  private noteFiles: Map<string, string> | undefined;
  /** Same idea as `noteFiles`, but for canvases — flat (no folder support for canvases), keyed
   * by filename (not a relPath) since there's no subdirectory nesting to represent. */
  private canvasFiles: Map<string, string> | undefined;

  constructor(private readonly vaultDir: string) {}

  private astroDir(): string {
    return path.join(this.vaultDir, ASTRO_SUBDIR);
  }

  private notesDir(): string {
    return path.join(this.astroDir(), "notes");
  }

  private canvasesDir(): string {
    return path.join(this.astroDir(), "canvases");
  }

  private metaPath(): string {
    return path.join(this.astroDir(), VAULT_META_FILE);
  }

  /** One-time, idempotent move of a pre-`.astro` vault (top-level `vault.json`/`notes`/`canvases`)
   * into `.astro/`, then renames opaque `n_….md` filenames to title-mirrored ones. A no-op vault
   * (no legacy `vault.json`) or an already-migrated one (`.astro/vault.json` present) does
   * nothing. Never touches a `notes/` folder that isn't Astro's own (no legacy `vault.json`
   * sibling) — we don't guess about a folder we didn't author. */
  async migrateIfNeeded(): Promise<void> {
    const legacyMeta = path.join(this.vaultDir, VAULT_META_FILE);
    if (!(await pathExists(legacyMeta)) || (await pathExists(this.metaPath()))) return;

    await mkdir(this.astroDir(), { recursive: true });
    for (const entry of [VAULT_META_FILE, "notes", "canvases"]) {
      const from = path.join(this.vaultDir, entry);
      if (await pathExists(from)) {
        await rename(from, path.join(this.astroDir(), entry));
      }
    }

    // Rename opaque n_….md / c_….scanvas files to title/name-mirrored ones now that they live
    // under .astro/notes|canvases/.
    const files = await listFiles(this.notesDir(), NOTE_EXT);
    const taken = new Set(files.map((f) => f.toLowerCase()));
    for (const file of files) {
      const id = file.slice(0, -NOTE_EXT.length);
      const raw = await readFile(path.join(this.notesDir(), file), "utf8");
      const note = parseNote(id, raw);
      taken.delete(file.toLowerCase());
      const desired = filenameForTitle(note.title, note.id, NOTE_EXT, taken);
      taken.add(desired.toLowerCase());
      if (desired !== file) {
        await rename(path.join(this.notesDir(), file), path.join(this.notesDir(), desired));
      }
    }

    const canvasFiles = await listFiles(this.canvasesDir(), CANVAS_EXT);
    const canvasTaken = new Set(canvasFiles.map((f) => f.toLowerCase()));
    for (const file of canvasFiles) {
      const id = file.slice(0, -CANVAS_EXT.length);
      const raw = await readFile(path.join(this.canvasesDir(), file), "utf8");
      const canvas = JSON.parse(raw) as CanvasDoc;
      canvasTaken.delete(file.toLowerCase());
      const desired = filenameForTitle(canvas.name, canvas.id, CANVAS_EXT, canvasTaken);
      canvasTaken.add(desired.toLowerCase());
      if (desired !== file) {
        await rename(path.join(this.canvasesDir(), file), path.join(this.canvasesDir(), desired));
      }
    }
  }

  /** Rebuilds the id→relPath map from every note file on disk — the only way this adapter knows
   * "which file is note X" now that filenames mirror titles instead of ids. Also where external
   * changes (Explorer rename, a brand-new `.md` dropped in, a file with no frontmatter yet) get
   * folded in, per docs/ARCH-VAULT-STORAGE.md problem 2 — the filename always wins over a stale
   * frontmatter title, since renaming the *file* is the user's rename intent. */
  private async rescanNotes(): Promise<Map<string, string>> {
    const relPaths = await walkFiles(this.notesDir(), NOTE_EXT);
    const map = new Map<string, string>();
    for (const relPath of relPaths) {
      const fullPath = path.join(this.notesDir(), ...relPath.split("/"));
      // Windows editors (historically Notepad, still some others) can prepend a UTF-8 BOM — strip
      // it before testing for frontmatter, or a perfectly normal note gets misread as external
      // content with no frontmatter at all, minting it a brand-new id and destroying the old one.
      const raw = stripBom(await readFile(fullPath, "utf8"));
      const relBase = path.basename(relPath, NOTE_EXT);
      // The identity a note falls back to when its frontmatter carries no `id` must be unique per
      // FILE, not per filename. An imported Obsidian vault keeps one `Status.md`, `Roadmap.md` and
      // `Sessions.md` inside every project folder; keying on the basename made them collide in this
      // very map, so opening such a vault showed a fraction of it and hid the rest with no error.
      // The vault-relative path is unique by construction and, unlike a minted id, does not mean
      // rewriting every one of the user's files on first open just to claim them.
      const fallbackId = relPath.slice(0, -NOTE_EXT.length);

      if (!/^---\r?\n/.test(raw)) {
        // A file with no frontmatter at all — created outside Astro. Mint it a stable identity.
        const now = new Date().toISOString();
        const note: Note = { id: newNoteId(), title: relBase, tags: [], createdAt: now, updatedAt: now, body: raw };
        await atomicWriteFile(fullPath, serializeNote(note));
        map.set(note.id, relPath);
        continue;
      }

      const note = parseNote(fallbackId, raw, relBase);
      const expectedBase = sanitizeTitle(note.title) || relBase;
      const collisionStripped = relBase.replace(/ \(\d+\)$/, "");
      if (relBase !== expectedBase && collisionStripped !== expectedBase) {
        // Filename changed to something the title doesn't explain (not just our own " (2)"
        // collision suffix) — an external rename. The filename wins: adopt it as the new title.
        note.title = relBase;
        note.updatedAt = new Date().toISOString();
        await atomicWriteFile(fullPath, serializeNote(note));
      }
      map.set(note.id, relPath);
    }
    this.noteFiles = map;
    return map;
  }

  private async ensureNoteFiles(): Promise<Map<string, string>> {
    return this.noteFiles ?? (await this.rescanNotes());
  }

  /** Rebuilds the id→filename map for canvases — same filename-mirrors-name idea as notes (see
   * `rescanNotes`), just flat: canvases have no folder concept. Unlike notes, an external rename
   * doesn't get an "adopt as new name" correction here, since nothing else reads a canvas's `name`
   * as identity — it's cosmetic. Filename still gets re-derived from `name` on the next write. */
  private async rescanCanvases(): Promise<Map<string, string>> {
    const files = await listFiles(this.canvasesDir(), CANVAS_EXT);
    const map = new Map<string, string>();
    for (const file of files) {
      const raw = await readFile(path.join(this.canvasesDir(), file), "utf8");
      const canvas = JSON.parse(raw) as CanvasDoc;
      map.set(canvas.id, file);
    }
    this.canvasFiles = map;
    return map;
  }

  private async ensureCanvasFiles(): Promise<Map<string, string>> {
    return this.canvasFiles ?? (await this.rescanCanvases());
  }

  async getMeta(): Promise<VaultMeta | undefined> {
    const raw = await readFileIfExists(this.metaPath());
    return raw === undefined ? undefined : (JSON.parse(raw) as VaultMeta);
  }

  async writeMeta(meta: VaultMeta): Promise<void> {
    await atomicWriteFile(this.metaPath(), JSON.stringify(meta, null, 2));
  }

  async listNotes(): Promise<NoteMeta[]> {
    const map = await this.rescanNotes(); // full rescan: this is also the "pick up external changes" path
    const notes = await Promise.all(
      [...map.entries()].map(async ([id, relPath]) => {
        const raw = await readFile(path.join(this.notesDir(), ...relPath.split("/")), "utf8");
        // Same split as rescanNotes: `id` may be the vault-relative path (unique), but the title a
        // note shows is its plain filename — passing the id as both would label every imported note
        // with its full path.
        const note = parseNote(id, raw, path.basename(relPath, NOTE_EXT));
        return { ...note, folder: folderOf(relPath) };
      }),
    );
    return notes.map(toNoteMeta);
  }

  /** Renderer-triggered refresh (store.ts calls this on window focus) — identical to `listNotes`,
   * named separately so call sites read as intent ("catch up with Explorer") rather than a plain
   * listing. */
  async rescan(): Promise<NoteMeta[]> {
    return this.listNotes();
  }

  async readNote(id: string): Promise<Note> {
    let map = await this.ensureNoteFiles();
    let relPath = map.get(id);
    if (relPath === undefined) {
      map = await this.rescanNotes(); // covers a note created externally since the last scan
      relPath = map.get(id);
    }
    if (relPath === undefined) throw new Error(`找不到笔记：${id}`);
    const raw = await readFile(path.join(this.notesDir(), ...relPath.split("/")), "utf8");
    const note = parseNote(id, raw, path.basename(relPath, NOTE_EXT));
    return { ...note, folder: folderOf(relPath) };
  }

  /** Writes a note's frontmatter+body, renaming its file when the title (or folder) changed —
   * see docs/ARCH-VAULT-STORAGE.md problem 2. Collisions within the target folder get a
   * ` (2)`/` (3)` suffix; a different note's file is never overwritten. */
  async writeNote(note: Note): Promise<void> {
    const map = await this.ensureNoteFiles();
    const currentRelPath = map.get(note.id);
    const targetFolder = note.folder ?? folderOf(currentRelPath ?? "") ?? undefined;

    const takenInFolder = new Set(
      [...map.entries()]
        .filter(([id, relPath]) => id !== note.id && folderOf(relPath) === targetFolder)
        .map(([, relPath]) => path.basename(relPath).toLowerCase()),
    );
    const filename = filenameForTitle(note.title, note.id, NOTE_EXT, takenInFolder);
    const desiredRelPath = targetFolder ? `${targetFolder}/${filename}` : filename;

    const newFullPath = path.join(this.notesDir(), ...desiredRelPath.split("/"));
    if (currentRelPath !== undefined && currentRelPath !== desiredRelPath) {
      const oldFullPath = path.join(this.notesDir(), ...currentRelPath.split("/"));
      await mkdir(path.dirname(newFullPath), { recursive: true });
      await rename(oldFullPath, newFullPath);
    }
    await atomicWriteFile(newFullPath, serializeNote(note));
    map.set(note.id, desiredRelPath);
  }

  /** Moves a note into `folder` (or the root, if `folder` is undefined) without changing its
   * title/filename — the storage side of dragging a star into a folder in the graph. */
  async moveNote(id: string, folder: string | undefined): Promise<void> {
    if (folder && folder.split("/").some(part => !part || part === "." || part === ".." || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new Error("文件夹路径无效，请使用知识库内的分类名称。");
    }
    const map = await this.ensureNoteFiles();
    const currentRelPath = map.get(id);
    if (currentRelPath === undefined) throw new Error(`找不到笔记：${id}`);
    let filename = path.basename(currentRelPath);
    const taken = new Set([...map.entries()]
      .filter(([otherId, relPath]) => otherId !== id && (process.platform === "win32" ? folderOf(relPath)?.toLowerCase() === (folder?.toLowerCase() || undefined) : folderOf(relPath) === (folder || undefined)))
      .map(([, relPath]) => path.basename(relPath).toLowerCase()));
    if (taken.has(filename.toLowerCase())) {
      const note = await this.readNote(id);
      filename = filenameForTitle(note.title, id, NOTE_EXT, taken);
    }
    const desiredRelPath = folder ? `${folder}/${filename}` : filename;
    if (desiredRelPath === currentRelPath) return;
    const oldFullPath = path.join(this.notesDir(), ...currentRelPath.split("/"));
    const newFullPath = path.join(this.notesDir(), ...desiredRelPath.split("/"));
    await mkdir(path.dirname(newFullPath), { recursive: true });
    await rename(oldFullPath, newFullPath);
    map.set(id, desiredRelPath);
  }

  async deleteNote(id: string): Promise<void> {
    const map = await this.ensureNoteFiles();
    const relPath = map.get(id);
    if (relPath === undefined) return;
    await unlinkIfExists(path.join(this.notesDir(), ...relPath.split("/")));
    map.delete(id);
  }

  async listCanvases(): Promise<CanvasMeta[]> {
    const map = await this.rescanCanvases();
    const canvases = await Promise.all(
      [...map.values()].map(async (file) => {
        const raw = await readFile(path.join(this.canvasesDir(), file), "utf8");
        return JSON.parse(raw) as CanvasDoc;
      }),
    );
    return canvases.map(toCanvasMeta);
  }

  async readCanvas(id: string): Promise<CanvasDoc> {
    let map = await this.ensureCanvasFiles();
    let file = map.get(id);
    if (file === undefined) {
      map = await this.rescanCanvases();
      file = map.get(id);
    }
    if (file === undefined) throw new Error(`找不到星图：${id}`);
    const raw = await readFileIfExists(path.join(this.canvasesDir(), file));
    if (raw === undefined) throw new Error(`找不到星图：${id}`);
    return JSON.parse(raw) as CanvasDoc;
  }

  /** Writes a canvas, renaming its file to mirror its (possibly changed) `name` — the same
   * filename-derivation notes use (see `writeNote`). */
  async writeCanvas(doc: CanvasDoc): Promise<void> {
    const map = await this.ensureCanvasFiles();
    const currentFile = map.get(doc.id);
    const taken = new Set(
      [...map.entries()].filter(([id]) => id !== doc.id).map(([, file]) => file.toLowerCase()),
    );
    const filename = filenameForTitle(doc.name, doc.id, CANVAS_EXT, taken);
    const newFullPath = path.join(this.canvasesDir(), filename);
    if (currentFile !== undefined && currentFile !== filename) {
      await rename(path.join(this.canvasesDir(), currentFile), newFullPath);
    }
    await atomicWriteFile(newFullPath, JSON.stringify(doc, null, 2));
    map.set(doc.id, filename);
  }

  async deleteCanvas(id: string): Promise<void> {
    const map = await this.ensureCanvasFiles();
    const file = map.get(id);
    if (file === undefined) return;
    await unlinkIfExists(path.join(this.canvasesDir(), file));
    map.delete(id);
  }
}

