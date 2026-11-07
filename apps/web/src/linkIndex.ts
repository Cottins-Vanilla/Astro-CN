import { buildLinkIndex, type LinkIndex } from "@solen/core";
import { useStore, vault } from "./store";

/**
 * Build the full knowledge graph across every note and canvas in the vault
 * (per docs/ARCHITECTURE.md, it's derived — never stored). This reads every
 * note body and canvas document, so it's meant for the graph view and the
 * editor's connections strip (backlinks), not for something called on every
 * keystroke.
 */
export async function loadLinkIndex(): Promise<LinkIndex> {
  // Await complete title + backlink saves; elapsed debounce time cannot guarantee slow disk I/O.
  await useStore.getState().flushNoteSaves();
  const [noteMetas, canvasMetas] = await Promise.all([vault.listNotes(), vault.listCanvases()]);
  const [notes, canvases] = await Promise.all([
    Promise.all(noteMetas.map((n) => vault.readNote(n.id))),
    Promise.all(canvasMetas.map((c) => vault.readCanvas(c.id))),
  ]);
  return buildLinkIndex(notes, canvases);
}
