import { describe, expect, it } from "vitest";
import { buildLinkIndex, ghostTitleFromId } from "../graph.js";
import type { CanvasDoc, Note } from "../types.js";

function note(id: string, title: string, body: string, folder?: string): Note {
  return { id, title, tags: [], createdAt: "", updatedAt: "", body, folder };
}

/** The shape an imported Obsidian vault actually has: path-style link targets, and one `Status`
 * per project rather than one in the whole vault. */
function projectVault(): Note[] {
  return [
    note("n_hub", "00_HOME", "see [[02_Projects/JARVIS/Status]] and [[02_Projects/Codger/Status]]"),
    note("n_j_status", "Status", "back to [[00_HOME]], sibling [[Roadmap]]", "02_Projects/JARVIS"),
    note("n_j_roadmap", "Roadmap", "", "02_Projects/JARVIS"),
    note("n_c_status", "Status", "sibling [[Roadmap]]", "02_Projects/Codger"),
    note("n_c_roadmap", "Roadmap", "", "02_Projects/Codger"),
  ];
}

describe("buildLinkIndex", () => {
  it("resolves wiki-links case-insensitively by title", () => {
    const a = note("n_a", "Alpha", "links to [[beta]]");
    const b = note("n_b", "Beta", "no links");
    const { nodes, edges } = buildLinkIndex([a, b], []);

    expect(nodes.map((n) => n.id).sort()).toEqual(["n_a", "n_b"]);
    expect(edges).toEqual([{ from: "n_a", to: "n_b", source: "wikilink" }]);
  });

  it("creates ghost nodes for unresolved targets", () => {
    const a = note("n_a", "Alpha", "links to [[Nowhere]]");
    const { nodes, edges } = buildLinkIndex([a], []);

    const ghost = nodes.find((n) => n.id === "ghost:nowhere");
    expect(ghost).toEqual({ id: "ghost:nowhere", title: "Nowhere", ghost: true });
    expect(edges).toEqual([{ from: "n_a", to: "ghost:nowhere", source: "wikilink" }]);
  });

  it("resolves an Obsidian path-style target to the note at that exact path", () => {
    const { edges } = buildLinkIndex(projectVault(), []);
    const fromHub = edges.filter((e) => e.from === "n_hub").map((e) => e.to);
    // Not ghosts, and each path picks its own project's Status rather than collapsing onto one.
    expect(fromHub).toEqual(["n_j_status", "n_c_status"]);
  });

  it("keeps every note of a repeated title reachable, resolving a bare link within its own folder", () => {
    const { edges } = buildLinkIndex(projectVault(), []);
    // Each project's Status links to ITS OWN Roadmap, though five notes share two titles.
    expect(edges).toContainEqual({ from: "n_j_status", to: "n_j_roadmap", source: "wikilink" });
    expect(edges).toContainEqual({ from: "n_c_status", to: "n_c_roadmap", source: "wikilink" });
  });

  it("falls back to the tail of a path that no longer exists, instead of a ghost", () => {
    // A vault reorganised after the link was written: the folders are stale, the note is not.
    const notes = [note("n_a", "Alpha", "[[some/old/place/Beta]]"), note("n_b", "Beta", "", "current")];
    const { edges, nodes } = buildLinkIndex(notes, []);
    expect(nodes.some((n) => n.ghost)).toBe(false);
    expect(edges).toEqual([{ from: "n_a", to: "n_b", source: "wikilink" }]);
  });

  it("still ghosts a path target that matches no note anywhere", () => {
    const { nodes } = buildLinkIndex([note("n_a", "Alpha", "[[02_Projects/Nothing/Here]]")], []);
    expect(nodes.find((n) => n.ghost)?.id).toBe("ghost:02_projects/nothing/here");
  });

  it("is deterministic when a bare title is ambiguous and none share the linker's folder", () => {
    const notes = [
      note("n_src", "Source", "[[Status]]", "elsewhere"),
      note("n_z", "Status", "", "zeta"),
      note("n_a", "Status", "", "alpha"),
    ];
    const first = buildLinkIndex(notes, []).edges;
    const reordered = buildLinkIndex([notes[0], notes[2], notes[1]], []).edges;
    expect(first).toEqual(reordered);
    expect(first[0].to).toBe("n_a"); // lowest folder path, not whichever came last off disk
  });

  it("includes canvas edges between note nodes", () => {
    const a = note("n_a", "Alpha", "");
    const b = note("n_b", "Beta", "");
    const canvas: CanvasDoc = {
      format: "scanvas",
      version: 1,
      id: "c_1",
      name: "Test",
      createdAt: "",
      updatedAt: "",
      nodes: [
        { id: "nd_1", type: "note", x: 0, y: 0, width: 1, height: 1, noteId: "n_a" },
        { id: "nd_2", type: "note", x: 0, y: 0, width: 1, height: 1, noteId: "n_b" },
      ],
      edges: [{ id: "e_1", from: "nd_1", to: "nd_2" }],
    };

    const { edges } = buildLinkIndex([a, b], [canvas]);
    expect(edges).toEqual([
      { from: "n_a", to: "n_b", source: "canvas", canvasId: "c_1", canvasEdgeId: "e_1" },
    ]);
  });
});

describe("ghostTitleFromId", () => {
  it("recovers the lowercased title a ghost node was conjured from", () => {
    // The graph's Unlink action holds only both endpoint ids; for a ghost endpoint there is no
    // note to look the title up in, so it has to come back out of the id itself.
    const { nodes } = buildLinkIndex([note("n_a", "Alpha", "links to [[Nowhere]]")], []);
    const ghost = nodes.find((n) => n.ghost)!;
    expect(ghostTitleFromId(ghost.id)).toBe("nowhere");
  });

  it("returns null for a real note id, so callers can tell the two apart", () => {
    expect(ghostTitleFromId("n_a")).toBeNull();
  });
});
