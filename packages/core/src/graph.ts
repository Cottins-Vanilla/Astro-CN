import type { CanvasDoc, Note } from "./types.js";
import { parseWikiLinks } from "./wikilinks.js";

export interface GraphNode {
  id: string;
  title: string;
  /** True when the node has no backing note — a wiki-link that resolved to nothing. */
  ghost?: true;
  /** Same-named field as `Note.folder` — a soft grouping signal, not part of edge/ghost logic. */
  folder?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  source: "wikilink" | "canvas";
  /** Canvas doc id this edge lives in — set only when `source === "canvas"`, so a
   * caller (e.g. the 3D graph's Unlink action) can remove the exact edge. */
  canvasId?: string;
  /** This edge's id within that canvas doc — set only when `source === "canvas"`. */
  canvasEdgeId?: string;
}

export interface LinkIndex {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Ghost nodes are the one node id in the graph with no backing note: this prefix plus the
 * lowercased wiki-link target that conjured them. */
const GHOST_ID_PREFIX = "ghost:";

/**
 * The lowercased title behind a ghost node id, or `null` for a real note id — so a caller holding
 * only an id (the 3D graph's Unlink action, which gets both endpoints of an edge) can tell the two
 * apart without a note lookup that would come back empty for a ghost either way. Lowercase is
 * enough for wiki-link removal, which matches case-insensitively.
 */
export function ghostTitleFromId(id: string): string | null {
  return id.startsWith(GHOST_ID_PREFIX) ? id.slice(GHOST_ID_PREFIX.length) : null;
}

/**
 * A wiki-link target reduced to the form note paths are compared in: forward slashes, no leading
 * `./` or `/`, no `.md` suffix, lowercased.
 *
 * Obsidian writes links as vault-relative paths — `[[02_Projects/JARVIS/Status]]` — and its vaults
 * routinely give many notes the same title (one `Status`, `Roadmap` and `Sessions` per project).
 * Resolution here used to key on the title alone, in a map where the last note with a given title
 * silently overwrote the rest, so importing such a vault turned every path-style link into a ghost
 * AND left all but one of each repeated title unreachable. Both are handled below.
 */
function normalizeTarget(target: string): string {
  return target
    .replace(/\\/g, "/")
    // `[[Note#Heading]]` and `[[Note#^block]]` point *into* a note; the note is still the link's
    // destination, and the graph has no finer granularity than a note to point at.
    .replace(/#.*$/, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.md$/i, "")
    .trim()
    .toLowerCase();
}

/** A note's full `folder/title` identity, in the same normalized form as `normalizeTarget`. */
function notePathKey(note: Note): string {
  const folder = (note.folder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
  const title = note.title.toLowerCase();
  return folder ? `${folder}/${title}` : title;
}

/** Deterministic pick when a target genuinely matches more than one note, so the same vault always
 * draws the same graph rather than depending on note order off disk. */
function firstByPath(candidates: Note[]): Note {
  return [...candidates].sort((a, b) => notePathKey(a).localeCompare(notePathKey(b)))[0];
}

/** Resolve a wiki-link using the same path and duplicate-title rules as the graph. */
export function createWikiLinkResolver(notes: Note[]): (target: string, from: Note) => Note | undefined {
  /** Every note that carries a given title — a list, not one winner, because repeated titles are
   * normal in an imported vault and each copy has to stay reachable. */
  const byLowerTitle = new Map<string, Note[]>();
  const byPath = new Map<string, Note>();

  for (const note of notes) {
    const title = note.title.toLowerCase();
    const sameTitle = byLowerTitle.get(title);
    if (sameTitle) sameTitle.push(note);
    else byLowerTitle.set(title, [note]);
    byPath.set(notePathKey(note), note);
  }

  /** Resolution order, narrowest first: the exact `folder/title` a path-style link names, then a
   * partial path (Obsidian shortens them when unambiguous), then the bare title — preferring a
   * note in the linking note's own folder, which is what `[[Status]]` written inside a project
   * folder means. */
  function resolve(target: string, from: Note): Note | undefined {
    const t = normalizeTarget(target);

    const exact = byPath.get(t);
    if (exact) return exact;

    if (t.includes("/")) {
      const suffix = `/${t}`;
      const partial = notes.filter((n) => notePathKey(n).endsWith(suffix));
      if (partial.length > 0) return firstByPath(partial);
      // A path whose folders match nothing still names a note at its tail: `[[old/path/Status]]`
      // after a reorganisation should find `Status` rather than becoming a ghost.
      const tail = t.slice(t.lastIndexOf("/") + 1);
      const byTail = byLowerTitle.get(tail);
      if (!byTail) return undefined;
      return byTail.length === 1 ? byTail[0] : firstByPath(byTail);
    }

    const candidates = byLowerTitle.get(t);
    if (!candidates) return undefined;
    if (candidates.length === 1) return candidates[0];
    const fromFolder = (from.folder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    const sameFolder = candidates.filter(
      (n) => (n.folder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase() === fromFolder,
    );
    return sameFolder.length > 0 ? firstByPath(sameFolder) : firstByPath(candidates);
  }

  return resolve;
}

/**
 * Derive the knowledge graph from note wiki-links and canvas note-to-note
 * edges. Nothing here is stored — it is rebuilt from source on demand.
 */
export function buildLinkIndex(notes: Note[], canvases: CanvasDoc[]): LinkIndex {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const resolve = createWikiLinkResolver(notes);
  for (const note of notes) nodes.set(note.id, { id: note.id, title: note.title, folder: note.folder });

  for (const note of notes) {
    for (const link of parseWikiLinks(note.body)) {
      const resolved = resolve(link.target, note);
      if (resolved) {
        edges.push({ from: note.id, to: resolved.id, source: "wikilink" });
      } else {
        const ghostId = `${GHOST_ID_PREFIX}${normalizeTarget(link.target)}`;
        if (!nodes.has(ghostId)) {
          nodes.set(ghostId, { id: ghostId, title: link.target, ghost: true });
        }
        edges.push({ from: note.id, to: ghostId, source: "wikilink" });
      }
    }
  }

  for (const canvas of canvases) {
    const noteNodeById = new Map(
      canvas.nodes
        .filter((n): n is Extract<typeof n, { type: "note" }> => n.type === "note")
        .map((n) => [n.id, n.noteId] as const),
    );
    for (const edge of canvas.edges) {
      const fromNoteId = noteNodeById.get(edge.from);
      const toNoteId = noteNodeById.get(edge.to);
      if (fromNoteId && toNoteId) {
        edges.push({ from: fromNoteId, to: toNoteId, source: "canvas", canvasId: canvas.id, canvasEdgeId: edge.id });
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}
