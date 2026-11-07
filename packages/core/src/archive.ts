import { parseNote, serializeNote } from "./frontmatter.js";
import type { CanvasDoc, Note, VaultMeta } from "./types.js";

/** In-memory contents of a vault, ready to serialize to (or read from) the
 * archive layout in docs/DATA-FORMAT.md's "Export archive" section. */
export interface VaultArchiveData {
  meta: VaultMeta;
  notes: Note[];
  canvases: CanvasDoc[];
}

/** A flat map of archive-relative path -> file bytes, e.g. `"notes/n_x.md"`.
 * This is what gets zipped (or unzipped) by the caller — this module knows
 * nothing about ZIP itself, only the directory layout. */
export type ArchiveFiles = Record<string, Uint8Array>;

const NOTES_DIR = "notes/";
const CANVASES_DIR = "canvases/";
const NOTE_EXT = ".md";
const CANVAS_EXT = ".scanvas";
const VAULT_META_PATH = "vault.json";

/** Serialize vault data to the archive directory layout, per docs/DATA-FORMAT.md. */
export function serializeArchive(data: VaultArchiveData): ArchiveFiles {
  const encoder = new TextEncoder();
  const files: ArchiveFiles = {};

  files[VAULT_META_PATH] = encoder.encode(JSON.stringify(data.meta, null, 2));

  for (const note of data.notes) {
    files[`${NOTES_DIR}${note.id}${NOTE_EXT}`] = encoder.encode(serializeNote(note));
  }

  for (const canvas of data.canvases) {
    files[`${CANVASES_DIR}${canvas.id}${CANVAS_EXT}`] = encoder.encode(JSON.stringify(canvas, null, 2));
  }

  return files;
}

/** Parse an archive's files back into vault data. Inverse of `serializeArchive`. */
export function deserializeArchive(files: ArchiveFiles): VaultArchiveData {
  const decoder = new TextDecoder();

  const metaBytes = files[VAULT_META_PATH];
  if (!metaBytes) throw new Error(`知识库备份无效，缺少：${VAULT_META_PATH}`);
  const meta = JSON.parse(decoder.decode(metaBytes)) as VaultMeta;

  const notes: Note[] = [];
  const canvases: CanvasDoc[] = [];

  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith(NOTES_DIR) && path.endsWith(NOTE_EXT)) {
      const id = path.slice(NOTES_DIR.length, -NOTE_EXT.length);
      notes.push(parseNote(id, decoder.decode(bytes)));
    } else if (path.startsWith(CANVASES_DIR) && path.endsWith(CANVAS_EXT)) {
      const id = path.slice(CANVASES_DIR.length, -CANVAS_EXT.length);
      const canvas = JSON.parse(decoder.decode(bytes)) as CanvasDoc;
      canvases.push({ ...canvas, id: canvas.id || id });
    }
  }

  return { meta, notes, canvases };
}

/** `<vault-name>.astro-vault.zip`, per docs/DATA-FORMAT.md's export archive naming. */
export function archiveFileName(vaultName: string): string {
  const slug = vaultName.trim().replace(/\s+/g, "-").toLowerCase() || "vault";
  return `${slug}.astro-vault.zip`;
}
