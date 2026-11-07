import { nanoid } from "nanoid";

/** Prefixes for each id-bearing entity, per docs/DATA-FORMAT.md. */
export const ID_PREFIXES = {
  note: "n_",
  canvas: "c_",
  node: "nd_",
  edge: "e_",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Generate a URL-safe, prefixed random id, e.g. "n_V1StGXR8_Z5jdHi6B-myT". */
export function generateId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}${nanoid(12)}`;
}

export const newNoteId = () => generateId("note");
export const newCanvasId = () => generateId("canvas");
export const newNodeId = () => generateId("node");
export const newEdgeId = () => generateId("edge");
