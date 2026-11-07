import Dexie, { type Table } from "dexie";
import type { CanvasDoc, CanvasMeta, Note, NoteMeta, VaultMeta } from "../types.js";
import type { VaultAdapter } from "../vault.js";

interface MetaRow {
  key: string;
  value: VaultMeta;
}

class VaultDatabase extends Dexie {
  notes!: Table<Note, string>;
  canvases!: Table<CanvasDoc, string>;
  meta!: Table<MetaRow, string>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({
      notes: "id, title, updatedAt",
      canvases: "id, name, updatedAt",
      meta: "key",
    });
  }
}

const VAULT_META_KEY = "vault";

/** VaultAdapter backed by IndexedDB (via Dexie) — the web app's default vault storage. */
export class IndexedDbVault implements VaultAdapter {
  private db: VaultDatabase;

  constructor(dbName = "solen-vault") {
    this.db = new VaultDatabase(dbName);
  }

  async getMeta(): Promise<VaultMeta | undefined> {
    const row = await this.db.meta.get(VAULT_META_KEY);
    return row?.value;
  }

  async writeMeta(meta: VaultMeta): Promise<void> {
    await this.db.meta.put({ key: VAULT_META_KEY, value: meta });
  }

  async listNotes(): Promise<NoteMeta[]> {
    const notes = await this.db.notes.toArray();
    return notes.map(({ body: _body, ...meta }) => meta);
  }

  async readNote(id: string): Promise<Note> {
    const note = await this.db.notes.get(id);
    if (!note) throw new Error(`找不到笔记：${id}`);
    return note;
  }

  async writeNote(note: Note): Promise<void> {
    await this.db.notes.put(note);
  }

  async deleteNote(id: string): Promise<void> {
    await this.db.notes.delete(id);
  }

  async rescan(): Promise<NoteMeta[]> {
    return this.listNotes(); // no external filesystem to catch up with here
  }

  async moveNote(id: string, folder: string | undefined): Promise<void> {
    const note = await this.readNote(id);
    await this.db.notes.put({ ...note, folder });
  }

  async listCanvases(): Promise<CanvasMeta[]> {
    const canvases = await this.db.canvases.toArray();
    return canvases.map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    }));
  }

  async readCanvas(id: string): Promise<CanvasDoc> {
    const canvas = await this.db.canvases.get(id);
    if (!canvas) throw new Error(`找不到星图：${id}`);
    return canvas;
  }

  async writeCanvas(doc: CanvasDoc): Promise<void> {
    await this.db.canvases.put(doc);
  }

  async deleteCanvas(id: string): Promise<void> {
    await this.db.canvases.delete(id);
  }
}
