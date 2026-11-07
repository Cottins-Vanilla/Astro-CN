import { describe, expect, it } from "vitest";
import { buildVaultFileGraph, type VaultFileNode } from "../vaultGraph.js";

function file(id: string, opts: Partial<VaultFileNode> = {}): VaultFileNode {
  const name = id.slice(id.lastIndexOf("/") + 1);
  return {
    id,
    name,
    ext: name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "",
    isDir: false,
    size: 100,
    updatedAt: "2026-07-18T12:00:00.000Z",
    ...opts,
  };
}

describe("buildVaultFileGraph", () => {
  it("emits a `contains` edge from every node to its parent folder", () => {
    const nodes = [
      file("research", { isDir: true }),
      file("research/Idea.md"),
      file("README.md"),
    ];
    const { edges } = buildVaultFileGraph(nodes, new Map());

    expect(edges).toContainEqual({ from: "research", to: "research/Idea.md", kind: "contains" });
    // Root-level files/folders have no parent — no contains edge for them.
    expect(edges.filter((e) => e.to === "research" || e.to === "README.md")).toEqual([]);
  });

  it("emits a `mentions` edge when one file's text content includes another file's bare name", () => {
    const nodes = [file("Alpha.md"), file("Beta.md")];
    const textContents = new Map([["Alpha.md", "See also Beta for details."]]);
    const { edges } = buildVaultFileGraph(nodes, textContents);

    expect(edges).toContainEqual({ from: "Alpha.md", to: "Beta.md", kind: "mentions" });
    // Not reciprocal — Beta.md's content (absent from the map) isn't scanned.
    expect(edges.filter((e) => e.from === "Beta.md" && e.kind === "mentions")).toEqual([]);
  });

  it("never emits a mentions edge from a file to itself", () => {
    const nodes = [file("Self.md")];
    const textContents = new Map([["Self.md", "This file mentions self.md right here."]]);
    const { edges } = buildVaultFileGraph(nodes, textContents);

    expect(edges.filter((e) => e.kind === "mentions")).toEqual([]);
  });

  it("skips names shorter than the minimum to avoid false-positive noise", () => {
    const nodes = [file("Ok.md"), file("id.md")]; // "id" (2 chars) is below the threshold
    const textContents = new Map([["Ok.md", "the id here is not a real reference"]]);
    const { edges } = buildVaultFileGraph(nodes, textContents);

    expect(edges.filter((e) => e.kind === "mentions")).toEqual([]);
  });

  it("preserves every input node, including binary files with no text content", () => {
    const nodes = [file("photo.png", { ext: ".png" }), file("notes.md")];
    const { nodes: outNodes } = buildVaultFileGraph(nodes, new Map([["notes.md", "no mention of the image"]]));

    expect(outNodes).toEqual(nodes);
  });
});
