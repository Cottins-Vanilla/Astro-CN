import type { CanvasDoc, CanvasMeta, Note, NoteMeta, VaultMeta } from "./types.js";

/**
 * Storage-agnostic access to a vault's notes and canvases. Implementations
 * back this with IndexedDB, the filesystem, or a sync service — nothing
 * above this interface changes.
 */
export interface VaultAdapter {
  /** Reads `vault.json`'s contents. `undefined` when the vault has never been
   * written yet (a brand-new IndexedDB database, or an empty vault folder) —
   * callers (see apps/web/src/store.ts's `init`) treat that as "seed me". */
  getMeta(): Promise<VaultMeta | undefined>;
  writeMeta(meta: VaultMeta): Promise<void>;
  listNotes(): Promise<NoteMeta[]>;
  readNote(id: string): Promise<Note>;
  writeNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /** Re-reads storage to pick up changes made outside the app (an external file rename/edit on
   * the filesystem adapter) — the IndexedDB adapter has no such "outside," so it's just
   * `listNotes()` there. Called on window focus (see apps/web/src/store.ts). */
  rescan(): Promise<NoteMeta[]>;
  /** Moves a note into `folder` (or the root, if undefined) — a rename on the filesystem adapter,
   * a plain field update on IndexedDB. */
  moveNote(id: string, folder: string | undefined): Promise<void>;
  listCanvases(): Promise<CanvasMeta[]>;
  readCanvas(id: string): Promise<CanvasDoc>;
  writeCanvas(doc: CanvasDoc): Promise<void>;
  deleteCanvas(id: string): Promise<void>;
}
