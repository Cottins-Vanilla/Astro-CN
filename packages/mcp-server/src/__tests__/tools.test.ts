import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGraphTool,
  getVaultFileGraphTool,
  listCanvasesTool,
  listNotesTool,
  readCanvasTool,
  readNoteTool,
  searchNotesTool,
  writeNoteTool,
} from "../tools.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture-vault");

// writeNoteTool mutates disk, so each test gets its own copy of the fixture.
let vaultDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(path.join(tmpdir(), "solen-mcp-test-"));
  await cp(FIXTURE_DIR, vaultDir, { recursive: true });
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

describe("listNotesTool", () => {
  it("lists note metadata sorted by most-recently updated", async () => {
    const notes = await listNotesTool(vaultDir);
    expect(notes.map((n) => n.id)).toEqual(["n_beta", "n_alpha"]);
    expect(notes[0]).not.toHaveProperty("body");
  });
});

describe("readNoteTool", () => {
  it("reads a note by id", async () => {
    const note = await readNoteTool(vaultDir, { id: "n_alpha" });
    expect(note.title).toBe("Alpha");
    expect(note.body).toContain("[[Beta]]");
  });

  it("reads a note by title, case-insensitively", async () => {
    const note = await readNoteTool(vaultDir, { title: "beta" });
    expect(note.id).toBe("n_beta");
  });

  it("throws for an unknown id", async () => {
    await expect(readNoteTool(vaultDir, { id: "nope" })).rejects.toThrow(/not found/i);
  });
});

describe("searchNotesTool", () => {
  it("finds matches in the body with a snippet", async () => {
    const results = await searchNotesTool(vaultDir, "distributed systems");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("n_alpha");
    expect(results[0].snippet).toContain("distributed systems");
  });

  it("matches on title alone", async () => {
    const results = await searchNotesTool(vaultDir, "beta");
    expect(results.map((r) => r.id)).toContain("n_beta");
  });

  it("is case-insensitive and returns nothing for no match", async () => {
    expect(await searchNotesTool(vaultDir, "DISTRIBUTED")).toHaveLength(1);
    expect(await searchNotesTool(vaultDir, "nonexistent-term")).toHaveLength(0);
  });
});

describe("writeNoteTool", () => {
  it("creates a new note and persists it to disk", async () => {
    const created = await writeNoteTool(vaultDir, { title: "Gamma", body: "New note body #fresh" });
    expect(created.id).toBeTruthy();
    expect(created.tags).toEqual(["fresh"]);

    const reread = await readNoteTool(vaultDir, { id: created.id });
    expect(reread.body).toBe("New note body #fresh");

    const notes = await listNotesTool(vaultDir);
    expect(notes.map((n) => n.id)).toContain(created.id);
  });

  it("overwrites an existing note by id and bumps updatedAt", async () => {
    const before = await readNoteTool(vaultDir, { id: "n_beta" });
    const updated = await writeNoteTool(vaultDir, { id: "n_beta", title: "Beta v2", body: "Rewritten body" });
    expect(updated.id).toBe("n_beta");
    expect(updated.title).toBe("Beta v2");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before.updatedAt).getTime());

    const reread = await readNoteTool(vaultDir, { id: "n_beta" });
    expect(reread.body).toBe("Rewritten body");
  });

  it("throws when overwriting an id that doesn't exist", async () => {
    await expect(writeNoteTool(vaultDir, { id: "nope", title: "x", body: "x" })).rejects.toThrow(/not found/i);
  });
});

describe("listCanvasesTool / readCanvasTool", () => {
  it("lists and reads a canvas", async () => {
    const canvases = await listCanvasesTool(vaultDir);
    expect(canvases.map((c) => c.id)).toEqual(["c_main"]);

    const byId = await readCanvasTool(vaultDir, { id: "c_main" });
    expect(byId.nodes).toHaveLength(2);

    const byName = await readCanvasTool(vaultDir, { name: "main" });
    expect(byName.id).toBe("c_main");
  });
});

describe("getGraphTool", () => {
  it("derives the knowledge graph from wiki-links and canvas edges", async () => {
    const graph = await getGraphTool(vaultDir);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["n_alpha", "n_beta"]);
    expect(graph.edges).toContainEqual({ from: "n_alpha", to: "n_beta", source: "wikilink" });
    expect(graph.edges).toContainEqual({
      from: "n_alpha",
      to: "n_beta",
      source: "canvas",
      canvasId: "c_main",
      canvasEdgeId: "e_1",
    });
  });
});

describe("getVaultFileGraphTool", () => {
  it("covers every file and folder in the vault, not just Astro notes", async () => {
    const graph = await getVaultFileGraphTool(vaultDir);
    const ids = graph.nodes.map((n) => n.id).sort();

    expect(ids).toContain(".astro");
    expect(ids).toContain(".astro/notes/n_alpha.md");
    expect(ids).toContain(".astro/notes/n_beta.md");
    expect(ids).toContain(".astro/canvases/c_main.scanvas");

    expect(graph.edges).toContainEqual({ from: ".astro/notes", to: ".astro/notes/n_alpha.md", kind: "contains" });
  });

  it("never descends into .git or node_modules", async () => {
    await mkdir(path.join(vaultDir, ".git", "objects"), { recursive: true });
    await writeFile(path.join(vaultDir, ".git", "HEAD"), "ref: refs/heads/main", "utf8");
    await mkdir(path.join(vaultDir, "node_modules", "some-dep"), { recursive: true });
    await writeFile(path.join(vaultDir, "node_modules", "some-dep", "index.js"), "module.exports = {};", "utf8");

    const graph = await getVaultFileGraphTool(vaultDir);
    const ids = graph.nodes.map((n) => n.id);
    expect(ids.some((id) => id.startsWith(".git"))).toBe(false);
    expect(ids.some((id) => id.startsWith("node_modules"))).toBe(false);
  });
});
