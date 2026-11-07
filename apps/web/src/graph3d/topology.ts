import type { GraphNode, LinkIndex } from "@solen/core";

/** Same 5-accent hash used by the old 2D graph view, so recoloring never happens on upgrade. */
export const ACCENT_PALETTE = ["violet", "blue", "green", "amber", "red"] as const;
export type AccentName = (typeof ACCENT_PALETTE)[number];

export interface TopologyNode {
  id: string;
  title: string;
  ghost: boolean;
  degree: number;
  accent: AccentName;
  /** Slash-separated folder path (see packages/core's `Note.folder`) — a soft grouping signal
   * only; folders are not first-class graph nodes (see docs/ARCH-VAULT-STORAGE.md problem 3). */
  folder?: string;
}

export interface TopologyEdge {
  /** Node index (not id) into `GraphTopology.nodes` — positions/attributes are index-keyed for speed. */
  a: number;
  b: number;
  source: "wikilink" | "canvas";
  /** Set only when `source === "canvas"` — lets the Unlink popover remove this exact edge. */
  canvasId?: string;
  canvasEdgeId?: string;
}

/**
 * The graph, frozen into an index-addressable shape that physics, layouts,
 * and the renderer all read without touching each other's state. Rebuilt
 * only when the vault's link index changes (graph view opens, or notes are
 * edited) — never per frame.
 */
export interface GraphTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  /** Adjacency by node index, for hover highlighting and layout algorithms. */
  neighbors: number[][];
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic mulberry32 PRNG seeded from a hash, so jitter is stable per node id. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Degree → star radius, shared by every layout (Force/Constellation, 2D/3D alike) so switching
 * modes never makes a star "pop" and every well-connected hub reads as visibly bigger than a
 * sparsely-linked note, not just marginally so. */
export function starSize(degree: number): number {
  return Math.min(14, 4.5 + degree * 1.1);
}

export function buildTopology(index: LinkIndex): GraphTopology {
  const nodes: TopologyNode[] = index.nodes.map((n: GraphNode) => ({
    id: n.id,
    title: n.title,
    ghost: Boolean(n.ghost),
    degree: 0,
    accent: ACCENT_PALETTE[hashString(n.id) % ACCENT_PALETTE.length],
    folder: n.folder,
  }));
  const indexById = new Map(nodes.map((n, i) => [n.id, i]));
  const neighbors: number[][] = nodes.map(() => []);
  const edges: TopologyEdge[] = [];

  for (const e of index.edges) {
    const a = indexById.get(e.from);
    const b = indexById.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    edges.push({ a, b, source: e.source, canvasId: e.canvasId, canvasEdgeId: e.canvasEdgeId });
    nodes[a].degree++;
    nodes[b].degree++;
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  return { nodes, edges, neighbors };
}
