import { describe, expect, it } from "vitest";
import { archiveFileName, deserializeArchive, serializeArchive, type VaultArchiveData } from "../archive.js";
import type { CanvasDoc, Note, VaultMeta } from "../types.js";

function sampleData(): VaultArchiveData {
  const meta: VaultMeta = {
    format: "solen-vault",
    version: 1,
    name: "My Vault",
    createdAt: "2026-07-18T12:00:00.000Z",
    settings: { theme: "dark", "my-plugin.someSetting": 42 },
  };

  const notes: Note[] = [
    {
      id: "n_x1y2z3",
      title: "Distributed systems reading list",
      tags: ["reading", "systems"],
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T14:30:00.000Z",
      body: "Notes link to each other with [[Wiki Links]] by title.\nTags can also appear inline as #hashtags.",
    },
    {
      id: "n_abc",
      title: "Untitled",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: "",
    },
  ];

  const canvases: CanvasDoc[] = [
    {
      format: "scanvas",
      version: 1,
      id: "c_a1b2c3",
      name: "Project Atlas",
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T14:30:00.000Z",
      nodes: [
        { id: "nd_1", type: "note", x: 0, y: 0, width: 280, height: 180, noteId: "n_x1y2z3" },
        { id: "nd_2", type: "text", x: 400, y: 60, width: 220, height: 120, text: "Inline scratch text" },
        { id: "nd_3", type: "link", x: 400, y: 300, width: 220, height: 80, url: "https://example.com" },
        { id: "nd_4", type: "group", x: -40, y: -40, width: 800, height: 500, label: "Research", color: "violet" },
      ],
      edges: [{ id: "e_1", from: "nd_1", to: "nd_2", label: "supports", color: "violet" }],
    },
  ];

  return { meta, notes, canvases };
}

describe("archive round-trip", () => {
  it("serializes and re-parses vault data losslessly", () => {
    const data = sampleData();
    const files = serializeArchive(data);

    expect(Object.keys(files).sort()).toEqual(
      ["vault.json", "notes/n_x1y2z3.md", "notes/n_abc.md", "canvases/c_a1b2c3.scanvas"].sort(),
    );

    const parsed = deserializeArchive(files);
    expect(parsed.meta).toEqual(data.meta);
    expect(parsed.notes.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...data.notes].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(parsed.canvases).toEqual(data.canvases);
  });

  it("round-trips an empty vault", () => {
    const meta: VaultMeta = {
      format: "solen-vault",
      version: 1,
      name: "Empty",
      createdAt: "2026-01-01T00:00:00.000Z",
      settings: {},
    };
    const files = serializeArchive({ meta, notes: [], canvases: [] });
    expect(Object.keys(files)).toEqual(["vault.json"]);
    expect(deserializeArchive(files)).toEqual({ meta, notes: [], canvases: [] });
  });

  it("throws on a missing vault.json", () => {
    expect(() => deserializeArchive({})).toThrow(/vault\.json/);
  });
});

describe("archiveFileName", () => {
  it("slugifies the vault name and appends .astro-vault.zip", () => {
    expect(archiveFileName("My Vault")).toBe("my-vault.astro-vault.zip");
  });

  it("falls back to 'vault' for an empty name", () => {
    expect(archiveFileName("   ")).toBe("vault.astro-vault.zip");
  });
});
