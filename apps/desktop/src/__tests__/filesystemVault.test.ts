import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseNote, serializeNote, type CanvasDoc, type Note, type VaultMeta } from "@solen/core";
import { FilesystemVaultAdapter } from "../filesystemVault.js";

let vaultDir: string;
let adapter: FilesystemVaultAdapter;

const ASTRO = ".astro";

beforeEach(async () => {
  vaultDir = await mkdtemp(path.join(tmpdir(), "solen-vault-test-"));
  adapter = new FilesystemVaultAdapter(vaultDir);
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

function sampleMeta(): VaultMeta {
  return {
    format: "solen-vault",
    version: 1,
    name: "Test Vault",
    createdAt: "2026-07-18T12:00:00.000Z",
    settings: { theme: "dark", "my-plugin.someSetting": 42 },
  };
}

function sampleNote(id: string, title: string): Note {
  return {
    id,
    title,
    tags: ["reading", "systems"],
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T14:30:00.000Z",
    body: "Body with a [[Wiki Link]] and #inline-tag.",
  };
}

function sampleCanvas(id: string, name = "Graph"): CanvasDoc {
  return {
    format: "scanvas",
    version: 1,
    id,
    name,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T14:30:00.000Z",
    nodes: [
      { id: "nd_1", type: "note", x: 0, y: 0, width: 280, height: 180, noteId: "n_x1y2z3" },
      { id: "nd_2", type: "text", x: 400, y: 60, width: 220, height: 120, text: "scratch" },
    ],
    edges: [{ id: "e_1", from: "nd_1", to: "nd_2", label: "supports", color: "violet" }],
  };
}

describe("FilesystemVaultAdapter", () => {
  it("getMeta returns undefined for a brand-new/empty vault folder", async () => {
    await expect(adapter.getMeta()).resolves.toBeUndefined();
    await expect(adapter.listNotes()).resolves.toEqual([]);
    await expect(adapter.listCanvases()).resolves.toEqual([]);
  });

  it("writeMeta writes .astro/vault.json as pretty-printed JSON matching DATA-FORMAT.md, and round-trips via getMeta", async () => {
    const meta = sampleMeta();
    await adapter.writeMeta(meta);

    const rawPath = path.join(vaultDir, ASTRO, "vault.json");
    const raw = await readFile(rawPath, "utf8");
    expect(raw).toBe(JSON.stringify(meta, null, 2));
    expect(JSON.parse(raw)).toEqual(meta);

    await expect(adapter.getMeta()).resolves.toEqual(meta);
  });

  it("writeNote writes .astro/notes/<title>.md (filename mirrors title, not id), and round-trips via readNote", async () => {
    const note = sampleNote("n_x1y2z3", "Distributed systems reading list");
    await adapter.writeNote(note);

    const filePath = path.join(vaultDir, ASTRO, "notes", "Distributed systems reading list.md");
    const raw = await readFile(filePath, "utf8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("id: n_x1y2z3");
    expect(raw).toContain("title: Distributed systems reading list");
    expect(raw).toContain("tags: [reading, systems]");
    expect(raw).toContain(note.body);

    // parseNote (the same function the on-disk reader/writer both use) must recover exactly
    // what was written; the identity that matters is the frontmatter id, never the filename.
    expect(parseNote("n_x1y2z3", raw)).toEqual(note);

    await expect(adapter.readNote("n_x1y2z3")).resolves.toEqual(note);
  });

  it("renaming a note's title in-app renames its file on disk, keeping the same id", async () => {
    const note = sampleNote("n_ren", "Old Title");
    await adapter.writeNote(note);
    const oldPath = path.join(vaultDir, ASTRO, "notes", "Old Title.md");
    await expect(readFile(oldPath, "utf8")).resolves.toBeTruthy();

    const renamed = { ...note, title: "New Title", updatedAt: "2026-07-19T00:00:00.000Z" };
    await adapter.writeNote(renamed);

    await expect(readFile(oldPath, "utf8")).rejects.toThrow();
    const newPath = path.join(vaultDir, ASTRO, "notes", "New Title.md");
    await expect(readFile(newPath, "utf8")).resolves.toContain("title: New Title");
    await expect(adapter.readNote("n_ren")).resolves.toEqual(renamed);
  });

  it("two notes with the same title get ` (2)`/` (3)` filename suffixes, never overwriting each other", async () => {
    await adapter.writeNote(sampleNote("n_1", "Duplicate"));
    await adapter.writeNote(sampleNote("n_2", "Duplicate"));
    await adapter.writeNote(sampleNote("n_3", "Duplicate"));

    const files = (await readdir(path.join(vaultDir, ASTRO, "notes"))).sort();
    expect(files).toEqual(["Duplicate (2).md", "Duplicate (3).md", "Duplicate.md"]);
    await expect(adapter.readNote("n_1")).resolves.toMatchObject({ title: "Duplicate" });
    await expect(adapter.readNote("n_2")).resolves.toMatchObject({ title: "Duplicate" });
    await expect(adapter.readNote("n_3")).resolves.toMatchObject({ title: "Duplicate" });
  });

  it("a title with illegal filename characters is sanitized on disk but kept verbatim in frontmatter", async () => {
    const note = sampleNote("n_illegal", "Foo/Bar: <Baz>?");
    await adapter.writeNote(note);
    const files = await readdir(path.join(vaultDir, ASTRO, "notes"));
    expect(files).toEqual(["Foo Bar Baz.md"]);
    await expect(adapter.readNote("n_illegal")).resolves.toMatchObject({ title: "Foo/Bar: <Baz>?" });
  });

  it("moveNote relocates a note's file into a subdirectory and back, threading `folder` through reads", async () => {
    const note = sampleNote("n_move", "Movable");
    await adapter.writeNote(note);

    await adapter.moveNote("n_move", "research");
    await expect(readFile(path.join(vaultDir, ASTRO, "notes", "research", "Movable.md"), "utf8")).resolves.toBeTruthy();
    await expect(adapter.readNote("n_move")).resolves.toMatchObject({ folder: "research" });
    const listed = await adapter.listNotes();
    expect(listed.find((n) => n.id === "n_move")).toMatchObject({ folder: "research" });

    await adapter.moveNote("n_move", undefined);
    await expect(readFile(path.join(vaultDir, ASTRO, "notes", "Movable.md"), "utf8")).resolves.toBeTruthy();
    await expect(adapter.readNote("n_move")).resolves.toMatchObject({ folder: undefined });
  });

  it("writeCanvas writes .astro/canvases/<name>.scanvas (filename mirrors name, not id), and round-trips via readCanvas", async () => {
    const canvas = sampleCanvas("c_a1b2c3");
    await adapter.writeCanvas(canvas);

    const filePath = path.join(vaultDir, ASTRO, "canvases", "Graph.scanvas");
    const raw = await readFile(filePath, "utf8");
    expect(raw).toBe(JSON.stringify(canvas, null, 2));
    expect(JSON.parse(raw)).toEqual(canvas);

    await expect(adapter.readCanvas("c_a1b2c3")).resolves.toEqual(canvas);
  });

  it("renaming a canvas's name renames its file on disk, keeping the same id", async () => {
    const canvas = sampleCanvas("c_ren");
    await adapter.writeCanvas(canvas);
    const oldPath = path.join(vaultDir, ASTRO, "canvases", "Graph.scanvas");
    await expect(readFile(oldPath, "utf8")).resolves.toBeTruthy();

    const renamed = { ...canvas, name: "Renamed Canvas" };
    await adapter.writeCanvas(renamed);

    await expect(readFile(oldPath, "utf8")).rejects.toThrow();
    const newPath = path.join(vaultDir, ASTRO, "canvases", "Renamed Canvas.scanvas");
    const raw = await readFile(newPath, "utf8");
    expect(JSON.parse(raw)).toMatchObject({ name: "Renamed Canvas" });
    await expect(adapter.readCanvas("c_ren")).resolves.toEqual(renamed);
  });

  it("two canvases with the same name get ` (2)`/` (3)` filename suffixes, never overwriting each other", async () => {
    await adapter.writeCanvas(sampleCanvas("c_1"));
    await adapter.writeCanvas({ ...sampleCanvas("c_2"), name: "Graph" });
    await adapter.writeCanvas({ ...sampleCanvas("c_3"), name: "Graph" });

    const files = (await readdir(path.join(vaultDir, ASTRO, "canvases"))).sort();
    expect(files).toEqual(["Graph (2).scanvas", "Graph (3).scanvas", "Graph.scanvas"]);
  });

  it("readNote/readCanvas throw a descriptive error for a missing id", async () => {
    await expect(adapter.readNote("nope")).rejects.toThrow(/找不到笔记：nope/);
    await expect(adapter.readCanvas("nope")).rejects.toThrow(/找不到星图：nope/);
  });

  it("listNotes/listCanvases return the stripped metadata shape (no body / no nodes+edges)", async () => {
    const noteA = sampleNote("n_a", "Note A");
    const noteB = sampleNote("n_b", "Note B");
    await adapter.writeNote(noteA);
    await adapter.writeNote(noteB);
    const canvas = sampleCanvas("c_1");
    await adapter.writeCanvas(canvas);

    const noteList = await adapter.listNotes();
    expect(noteList.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "n_a", title: "Note A", tags: noteA.tags, createdAt: noteA.createdAt, updatedAt: noteA.updatedAt, folder: undefined },
      { id: "n_b", title: "Note B", tags: noteB.tags, createdAt: noteB.createdAt, updatedAt: noteB.updatedAt, folder: undefined },
    ]);
    for (const meta of noteList) expect(meta).not.toHaveProperty("body");

    const canvasList = await adapter.listCanvases();
    expect(canvasList).toEqual([
      { id: "c_1", name: canvas.name, createdAt: canvas.createdAt, updatedAt: canvas.updatedAt },
    ]);
    for (const meta of canvasList) {
      expect(meta).not.toHaveProperty("nodes");
      expect(meta).not.toHaveProperty("edges");
    }
  });

  it("deleteNote/deleteCanvas remove the underlying files (and are no-ops if already gone)", async () => {
    await adapter.writeNote(sampleNote("n_del", "To delete"));
    await adapter.writeCanvas(sampleCanvas("c_del"));

    await adapter.deleteNote("n_del");
    await adapter.deleteCanvas("c_del");

    await expect(adapter.readNote("n_del")).rejects.toThrow();
    await expect(adapter.readCanvas("c_del")).rejects.toThrow();
    await expect(adapter.listNotes()).resolves.toEqual([]);
    await expect(adapter.listCanvases()).resolves.toEqual([]);

    // Deleting an id that was never written must not throw.
    await expect(adapter.deleteNote("never-existed")).resolves.toBeUndefined();
    await expect(adapter.deleteCanvas("never-existed")).resolves.toBeUndefined();
  });

  it("leaves no leftover .tmp files after a batch of writes (atomic write-then-rename)", async () => {
    await adapter.writeMeta(sampleMeta());
    for (let i = 0; i < 10; i++) {
      await adapter.writeNote(sampleNote(`n_${i}`, `Note ${i}`));
      await adapter.writeCanvas(sampleCanvas(`c_${i}`, `Canvas ${i}`));
    }
    // Overwrite a couple in place too, to exercise the temp-file-then-rename path on an update
    // (here a title/name change, so also a file rename), not just a fresh create.
    await adapter.writeNote(sampleNote("n_0", "Note 0 (updated)"));
    await adapter.writeCanvas(sampleCanvas("c_0", "Canvas 0 (updated)"));

    const allEntries = [
      ...(await readdir(vaultDir)),
      ...(await readdir(path.join(vaultDir, ASTRO, "notes"))),
      ...(await readdir(path.join(vaultDir, ASTRO, "canvases"))),
    ];
    const tmpFiles = allEntries.filter((name) => name.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);

    // And the real files are exactly the expected set — no stray artifacts, and n_0's old
    // filename is gone since its title (hence filename) changed.
    const noteFiles = (await readdir(path.join(vaultDir, ASTRO, "notes"))).sort();
    const expectedNoteFiles = Array.from({ length: 10 }, (_, i) => (i === 0 ? "Note 0 (updated).md" : `Note ${i}.md`)).sort();
    expect(noteFiles).toEqual(expectedNoteFiles);
    const canvasFiles = (await readdir(path.join(vaultDir, ASTRO, "canvases"))).sort();
    const expectedCanvasFiles = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? "Canvas 0 (updated).scanvas" : `Canvas ${i}.scanvas`,
    ).sort();
    expect(canvasFiles).toEqual(expectedCanvasFiles);
  });

  it("a second adapter instance pointed at the same folder sees writes from the first (real disk state, no in-memory cache)", async () => {
    await adapter.writeMeta(sampleMeta());
    await adapter.writeNote(sampleNote("n_shared", "Shared"));

    const second = new FilesystemVaultAdapter(vaultDir);
    await expect(second.getMeta()).resolves.toEqual(sampleMeta());
    await expect(second.readNote("n_shared")).resolves.toEqual(sampleNote("n_shared", "Shared"));
  });

  it("an external rename (Explorer, not the app) is picked up on rescan — the filename wins over the stale frontmatter title", async () => {
    await adapter.writeNote(sampleNote("n_ext", "Original Title"));
    const dir = path.join(vaultDir, ASTRO, "notes");
    await rename(path.join(dir, "Original Title.md"), path.join(dir, "Renamed Externally.md"));

    const rescanned = await adapter.rescan();
    expect(rescanned.find((n) => n.id === "n_ext")).toMatchObject({ title: "Renamed Externally" });
    await expect(adapter.readNote("n_ext")).resolves.toMatchObject({ title: "Renamed Externally" });
    // Frontmatter on disk was rewritten to match, not just the in-memory view.
    const raw = await readFile(path.join(dir, "Renamed Externally.md"), "utf8");
    expect(raw).toContain("title: Renamed Externally");
  });

  it("a note file saved with a leading UTF-8 BOM (e.g. Windows Notepad) is still read as a real note, not adopted as external content", async () => {
    const note = sampleNote("n_bom", "BOM Note");
    await adapter.writeNote(note);
    const filePath = path.join(vaultDir, ASTRO, "notes", "BOM Note.md");
    const raw = await readFile(filePath, "utf8");
    await writeFile(filePath, "﻿" + raw, "utf8"); // simulate an external editor re-saving with a BOM

    const rescanned = await adapter.rescan();
    // The id must survive — a BOM misread would mint a brand-new id and orphan every reference.
    expect(rescanned.find((n) => n.id === "n_bom")).toMatchObject({ title: "BOM Note" });
    expect(rescanned).toHaveLength(1); // not duplicated under a freshly-minted second id
    await expect(adapter.readNote("n_bom")).resolves.toMatchObject({ title: "BOM Note" });
  });

  it("a .md file dropped in from outside the app (no frontmatter) is adopted with a minted id", async () => {
    const dir = path.join(vaultDir, ASTRO, "notes");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "Dropped In.md"), "Just some plain text, no frontmatter.", "utf8");

    const notes = await adapter.listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: "Dropped In" });
    expect(notes[0].id).toMatch(/^n_/);

    const raw = await readFile(path.join(dir, "Dropped In.md"), "utf8");
    expect(raw).toMatch(/^---\n/); // frontmatter was written back so it has a stable identity
  });

  it("migrateIfNeeded moves a legacy top-level vault into .astro/ and renames opaque filenames to titles", async () => {
    // Simulate a pre-.astro vault: top-level vault.json/notes/canvases, opaque <id>.md filenames.
    await mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await mkdir(path.join(vaultDir, "canvases"), { recursive: true });
    await writeFile(path.join(vaultDir, "vault.json"), JSON.stringify(sampleMeta(), null, 2), "utf8");
    const legacyNote = sampleNote("n_legacy", "Legacy Note");
    await writeFile(path.join(vaultDir, "notes", "n_legacy.md"), serializeNote(legacyNote), "utf8");
    await writeFile(
      path.join(vaultDir, "canvases", "c_legacy.scanvas"),
      JSON.stringify(sampleCanvas("c_legacy"), null, 2),
      "utf8",
    );

    const fresh = new FilesystemVaultAdapter(vaultDir);
    await fresh.migrateIfNeeded();

    await expect(readFile(path.join(vaultDir, "vault.json"), "utf8")).rejects.toThrow();
    await expect(fresh.getMeta()).resolves.toEqual(sampleMeta());
    await expect(fresh.readNote("n_legacy")).resolves.toEqual(legacyNote);
    const noteFiles = await readdir(path.join(vaultDir, ASTRO, "notes"));
    expect(noteFiles).toEqual(["Legacy Note.md"]); // opaque n_legacy.md renamed to mirror its title
    await expect(fresh.readCanvas("c_legacy")).resolves.toBeTruthy();

    // Idempotent: running it again on an already-migrated vault is a no-op.
    await fresh.migrateIfNeeded();
    await expect(fresh.readNote("n_legacy")).resolves.toEqual(legacyNote);
  });

  it("keeps every note when the same filename repeats across folders — an imported Obsidian vault", async () => {
    // One Status.md and one Roadmap.md per project is the normal shape of such a vault. Their
    // frontmatter carries no Astro `id`, so identity falls back to the file. Keyed on the basename
    // that fallback collided and listNotes returned a fraction of the vault, with nothing to say
    // the rest had been dropped: the worst kind of data loss, the silent kind.
    const projects = ["JARVIS", "Codger", "Astro"];
    for (const project of projects) {
      const dir = path.join(vaultDir, ASTRO, "notes", "02_Projects", project);
      await mkdir(dir, { recursive: true });
      for (const name of ["Status", "Roadmap"]) {
        await writeFile(path.join(dir, `${name}.md`), `---\ntags: []\n---\n${project} ${name}`, "utf8");
      }
    }

    const notes = await adapter.listNotes();
    expect(notes).toHaveLength(projects.length * 2);
    // Distinct identities, but each still shows the plain filename as its title.
    expect(new Set(notes.map((n) => n.id)).size).toBe(projects.length * 2);
    expect(notes.filter((n) => n.title === "Status")).toHaveLength(projects.length);
    // And each one still reads back its own body rather than some other project's.
    for (const project of projects) {
      const status = notes.find((n) => n.title === "Status" && n.folder === `02_Projects/${project}`)!;
      await expect(adapter.readNote(status.id)).resolves.toMatchObject({ body: `${project} Status` });
    }
  });

  it("migrateIfNeeded does nothing to a folder with no legacy vault.json — never touches a notes/ folder it didn't author", async () => {
    await mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await writeFile(path.join(vaultDir, "notes", "someone-elses-file.md"), "not ours", "utf8");

    await adapter.migrateIfNeeded();

    await expect(readFile(path.join(vaultDir, "notes", "someone-elses-file.md"), "utf8")).resolves.toBe("not ours");
    await expect(readFile(path.join(vaultDir, ASTRO, "vault.json"), "utf8")).rejects.toThrow();
  });
});

describe("文件夹移动保护", () => {
  it("移入同名笔记时保留两份文件和正文", async () => {
    const a={...sampleNote("n_collision_a","同名笔记"),folder:"Java",body:"第一份内容"};
    const b={...sampleNote("n_collision_b","同名笔记"),body:"第二份内容"};
    await adapter.writeNote(a);await adapter.writeNote(b);
    await adapter.moveNote(b.id,"Java");
    expect((await readdir(path.join(vaultDir,ASTRO,"notes","Java"))).sort()).toEqual(["同名笔记 (2).md","同名笔记.md"]);
    const fresh=new FilesystemVaultAdapter(vaultDir);
    await expect(fresh.readNote(a.id)).resolves.toMatchObject({body:a.body});
    await expect(fresh.readNote(b.id)).resolves.toMatchObject({body:b.body,folder:"Java"});
    const moved=await fresh.readNote(b.id);await fresh.writeNote({...moved,body:"移动后继续编辑"});
    await expect(fresh.readNote(a.id)).resolves.toMatchObject({body:a.body});
  });
  it("拒绝移出知识库目录", async () => {
    const note=sampleNote("n_safe_folder","保留笔记");await adapter.writeNote(note);
    for(const folder of ["../外部","/外部","C:/外部","a\\b","Java/../外部","CON"]){await expect(adapter.moveNote(note.id,folder)).rejects.toThrow();}
    await expect(adapter.readNote(note.id)).resolves.toMatchObject({body:note.body});
  });
  it.skipIf(process.platform!=="win32")("Windows 目录大小写不同也不会覆盖同名笔记", async () => {
    const a={...sampleNote("n_case_a","Case"),folder:"Java",body:"甲"};
    const b={...sampleNote("n_case_b","Case"),body:"乙"};
    await adapter.writeNote(a);await adapter.writeNote(b);await adapter.moveNote(b.id,"java");
    const fresh=new FilesystemVaultAdapter(vaultDir);
    await expect(fresh.readNote(a.id)).resolves.toMatchObject({body:"甲"});
    await expect(fresh.readNote(b.id)).resolves.toMatchObject({body:"乙"});
  });
});
