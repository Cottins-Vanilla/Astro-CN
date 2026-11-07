/**
 * Data model types matching docs/DATA-FORMAT.md.
 */

/** Named accent colors available for nodes, edges, and groups. */
export type AccentColor = "violet" | "blue" | "green" | "amber" | "red";

/** A color is either a named accent or a literal #rrggbb hex string. */
export type Color = AccentColor | `#${string}`;

/** Frontmatter + body of a note (.astro/notes/<title>.md — see docs/DATA-FORMAT.md). */
export interface Note {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Slash-separated path relative to notes/, e.g. "research/ideas" — undefined at the root.
   * Derived from the file's location on disk, never stored in frontmatter (DATA-FORMAT's
   * "self-describing, no duplicated truth" invariant). */
  folder?: string;
  /** Markdown body, everything below the frontmatter block. */
  body: string;
}

/** Lightweight note metadata, without the body — used for listings. */
export interface NoteMeta {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  folder?: string;
}

// These are declared with `type` rather than `interface` so they satisfy
// @xyflow/react's `Node<T extends Record<string, unknown>>` generic
// constraint (interfaces don't structurally match that constraint even
// though they're otherwise identical to an equivalent type alias).
type CanvasNodeBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: Color;
  /**
   * Open per-node UI/plugin payload (see docs/DATA-FORMAT.md — "Plugin node
   * types store their payload under `data`"). Core UI state that must
   * round-trip through the vault format, such as whether a node is pinned
   * to its expanded ("card") rendering tier, lives here rather than as a
   * new top-level field.
   */
  data?: Record<string, unknown>;
};

export type NoteCanvasNode = CanvasNodeBase & {
  type: "note";
  noteId: string;
};

export type TextCanvasNode = CanvasNodeBase & {
  type: "text";
  text: string;
};

export type LinkCanvasNode = CanvasNodeBase & {
  type: "link";
  url: string;
};

export type GroupCanvasNode = CanvasNodeBase & {
  type: "group";
  label: string;
};

/** A plugin-registered node type: unknown `type`, payload under open `data`. */
export type PluginCanvasNode = CanvasNodeBase & {
  type: string;
  data?: Record<string, unknown>;
};

export type CanvasNode =
  | NoteCanvasNode
  | TextCanvasNode
  | LinkCanvasNode
  | GroupCanvasNode
  | PluginCanvasNode;

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: Color;
}

/** A .scanvas document (canvases/<id>.scanvas). */
export interface CanvasDoc {
  format: "scanvas";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Lightweight canvas metadata, without nodes/edges — used for listings. */
export interface CanvasMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Open settings object; plugins may namespace their own keys. */
export interface VaultSettings {
  theme?: "dark" | "light";
  [key: string]: unknown;
}

/** vault.json */
export interface VaultMeta {
  format: "solen-vault";
  version: 1;
  name: string;
  createdAt: string;
  settings: VaultSettings;
}
