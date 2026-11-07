# ARCH: Vault storage — `.astro/` home, filename↔title sync, folders, migration

Status: design spec for executor (Sonnet 5). Architect: Opus 4.8. No code here — descriptions of what changes where.

Scope: the four storage problems below, plus room for a future graph-builder that walks the vault. Read alongside `docs/DATA-FORMAT.md` (current layout) and `docs/WORKSPACE-3D.md` (UI philosophy: the graph IS the workspace, direct manipulation, no dialogs).

---

## Core decision up front: `id` stays opaque, filename mirrors title

This one decision resolves problems 1–3. Justify it against the code that already exists:

- **Wiki-links already resolve by title, not filename/id.** `buildLinkIndex` (`packages/core/src/graph.ts`) keys `byLowerTitle` on `note.title.toLowerCase()`; `[[Title]]` never touches the filename. So making the filename mirror the title changes *nothing* about link resolution.
- **Canvas edges and the AI link index key on the opaque `id`.** Canvas `note` nodes store `noteId` (`n_…`); `graph.ts` emits ghost ids and canvas edges by `id`. If the filename *became* the id (Obsidian's model), every title rename would rewrite every canvas edge's `noteId` and every stored reference — a cascade. Obsidian tolerates that because it has no separate structural-edge store; Astro does (`.scanvas`). So Obsidian's "id IS filename" is the wrong fit here.
- **The `id` is already in frontmatter.** `serializeNote` writes `id: n_…`; `parseNote(id, raw)` already prefers `fields.id` over the filename-derived id (`String(fields.id ?? id)`). The decoupling is 90% built — today the filename just happens to equal the id.

**Therefore:** `id` remains a stable opaque `n_…` string, the source of truth for it is the frontmatter, and the filename is a human-facing *mirror* of the title that Astro keeps in sync but never trusts for identity. Renames (in-app or in Explorer) never touch canvas edges or the AI index.

The one thing this costs: `readNote(id)`/`deleteNote(id)`/`notePath(id)` can no longer compute the path from the id. They need an **id→filename map**, built by scanning frontmatter. See problem 2.

---

## Problem 1 — Astro data lives under `.astro/`

**Design.** Astro's data moves from `<vaultDir>/{notes,canvases,vault.json}` to `<vaultDir>/.astro/{notes,canvases,vault.json}`. The dot-prefix hides it like `.git`/`.obsidian` and — critically — keeps Astro's bookkeeping out of the way of the *user's own files*, which now legitimately live at the vault root (see problem 3: folders are real dirs, and the graph-builder walks real user files).

```
re-website/                      ← vaultDir the user picked
├── .astro/
│   ├── vault.json
│   ├── notes/        n_….md files whose FILENAME mirrors the title
│   └── canvases/     c_….scanvas
├── My Project Ideas.md          ← (future) user files at root are fair game for graphify
└── research/                     ← a folder (problem 3)
```

Wait — that puts notes in two places (`.astro/notes/` *and* root). Resolve now: **Astro-authored notes live under `.astro/notes/`.** Root-level user files are *not* Astro notes; they are substrate a future graph-builder indexes (problem 4 research). Keeping them separate means Astro never has to guess whether a root `.md` is one of its notes or a user's stray file. `.astro/` is unambiguously Astro's.

**Single constant.** `filesystemVault.ts` and `vaultReader.ts` currently hardcode `notes`/`canvases`/`vault.json` off `vaultDir`. Introduce one path helper — `astroDir = path.join(vaultDir, ".astro")` — and hang `notesDir`/`canvasesDir`/`metaPath` off it. That's the whole change on the write side.

**Migration of an existing top-level `notes/`:** see problem 4. Do **not** auto-rename a user's folder.

---

## Problem 2 — Filename ↔ title bidirectional sync

The big one. Three directions to handle: (a) in-app title edit → file renames, (b) external file rename → title updates, (c) external content edit → picked up.

### Filename derivation

`filenameForTitle(title)` = sanitize title + `.md`, with disambiguation:

1. **Sanitize.** Replace Windows-illegal chars `/ \ : * ? " < > |` and control chars with a space; collapse runs of whitespace; trim; strip trailing dots/spaces (Windows rejects them). Cap length (~120 chars) to stay under path limits.
2. **Empty result** (title was empty, or all-illegal like `???`) → fall back to the opaque id: `n_….md`. A note with no usable title is still a valid file; it just wears its id until retitled. ponytail: id-as-filename is the existing behavior, so this is the zero-work fallback.
3. **Collision** (two notes sanitize to the same name) → append ` (2)`, ` (3)`, … before `.md`, deterministically by creation order (older note keeps the bare name). Never overwrite — the id→filename map (below) detects the clash before writing.
4. **Unicode** is fine on NTFS/APFS/ext4; keep it. Only the illegal-char set above is stripped.

Sanitization/disambiguation is pure and testable → put `filenameForTitle` + `sanitizeTitle` in `packages/core` (shared by the desktop adapter and the MCP writer, both of which must agree).

### Identity: the id→filename map

`readNote(id)`, `writeNote`, `deleteNote`, `notePath(id)` currently assume `notes/<id>.md`. With filenames mirroring titles, the adapter must map id→current filename. Build it by reading frontmatter:

- `FilesystemVaultAdapter` gains a private `Map<id, filename>` built lazily on first access (or on `listNotes`) by `readdir(notesDir)` + parsing each file's frontmatter `id`. Vaults are small (the existing code's stated assumption — "reads go straight to disk, simplicity wins over indexing"), so a full scan per session start is fine. ponytail: no watcher-maintained index, just rebuild the map when reads look stale.
- `writeNote(note)`: compute desired filename from title. If the map's current filename for this id differs → `rename` old→new (atomic, same dir), then `atomicWriteFile` new contents, update map. If same → just write. If the desired name collides with a *different* id → apply ` (n)` suffix.
- `deleteNote(id)`: look up filename in map, unlink, drop from map.
- `readNote(id)`: look up filename; if missing from map, rescan once (covers external creates).

### (a) In-app rename → file rename

`store.ts#updateNoteTitle` already sets the note's title and calls `scheduleNoteSave(id)` → debounced `vault.writeNote(note)`. Because `writeNote` now renames when the title changed, **in-app rename Just Works** with no new store logic. The only addition: `writeNote`'s IPC handler should return the note's new on-disk filename so nothing downstream assumes the old path (nothing currently does — the renderer keys everything on `id`).

### (b) & (c) External rename / external content edit → Astro picks it up

Two options were weighed:

- **`fs.watch`/chokidar live watcher.** Real-time, but: chokidar is a new dependency; `fs.watch` is famously unreliable per-platform (Windows fires on the dir, misses renames as delete+create, coalesces); and it races the app's own debounced writes (a save fires a change event Astro then re-reads mid-write). Handling that race well is real work.
- **Re-scan on window focus** (`BrowserWindow`'s `focus` event, or renderer `visibilitychange`). Zero dependencies, no race with self-writes (the app isn't focused while you're renaming in Explorer), dead simple. The cost: changes made *while Astro is focused* (rare — you're in Astro, not Explorer) aren't seen until you blur/focus.

**Decision: re-scan on focus.** It covers the actual user story ("I renamed a file in Explorer, tab back to Astro, it's updated") with no new dependency and no self-write race — squarely the WORKSPACE-3D "simplicity wins" ethos and matching the existing "no watcher/indexing" stance in both `filesystemVault.ts` and `vaultReader.ts`. `// ponytail: focus re-scan, not a live watcher — upgrade to chokidar only if users demand live external sync.`

**Superseded 2026-07-24: users did demand live sync.** Shipped `apps/desktop/src/vaultWatcher.ts`
— Node's own `fs.watch(dir, {recursive: true})` (no chokidar; supported natively on this app's
Windows/macOS targets), debounced 400ms, pushed to the renderer via `vault:externalChange`, which
calls the same `rescanVault()` the focus listener already used (kept as a harmless fallback for
the browser/IndexedDB build, which has no filesystem to watch). The self-write race flagged above
as "real work" turned out to be real: an independent audit caught that `rescanVault()`'s "unchanged"
fast-path comparison didn't actually check for a note with a pending debounced save
(`noteSaveTimers`), so an external touch anywhere in the vault could read a note's own file mid-
save and clobber the in-memory edit with stale disk content — `rescanVault()` (`store.ts`) now
skips any id with a pending save entirely, letting the in-memory version win until its own flush
lands.

**Mechanism.** On focus, the renderer calls a new `vault.rescan()` that: re-runs `listNotes()` (which rebuilds the id→filename map from frontmatter and returns fresh `NoteMeta`), diffs against the store's `noteList`/`notes`, and:
- **External rename** = same frontmatter `id`, new filename → title in frontmatter is unchanged, so *nothing to do for title*. **But** the user's intent when renaming the *file* is to rename the *note*. So: on rename detection (id known, filename changed, frontmatter title still matches the OLD filename's derived title), treat the new filename's base as the new title, write it into frontmatter, and update the store. If the frontmatter title was already edited to something unrelated, prefer frontmatter (the file content is more authoritative than the name) and just re-mirror the filename on next write. Flag: this heuristic is an open question (below).
- **External content edit** = same id+filename, changed mtime/body → re-read, update `notes[id]`/tags, emit `note:updated` so the graph rebuilds. The existing `SAVE_DEBOUNCE_MS` guard already exists so a focus-rescan won't read a note out from under an in-flight save (`store.ts` comment on `SAVE_DEBOUNCE_MS` already anticipates "external-change refresh must wait longer than this").
- **External new file** = unknown id (or no frontmatter `id`) → adopt it: if it has no frontmatter, synthesize one (`parseNote` already tolerates a bare `.md`, defaulting `id`/`title` to the filename — but for a *new* external file we must mint a real `n_…` id and write it back so the note gets a stable identity). Title = filename base.
- **External delete** = id in store, file gone → remove from store (mirror `deleteNote`'s store cleanup, incl. canvas-edge sweep).

### Collisions summary (must not crash / overwrite / produce invalid paths)

| Case | Resolution |
|---|---|
| Two notes same title | ` (2)`, ` (3)` suffix by creation order; map detects before write |
| Illegal chars | stripped to space in filename; frontmatter title keeps original |
| Empty/all-illegal title | filename falls back to `n_….md` |
| Unicode title | kept as-is (valid on all target FS) |
| Title collides on rename | suffix; never overwrite a different id |

---

## Problem 3 — Folders

**Disk representation:** a real subdirectory under `.astro/notes/`, e.g. `.astro/notes/research/Quantum notes.md`. Trivial for the filesystem side: `notesDir` scanning becomes recursive (`readdir` with recursion, or walk). A note's "folder" is just its parent dir relative to `notes/`. No new file type, no manifest — the directory tree *is* the folder model.

- `filesystemVault.ts` `listNotes` and `vaultReader.ts` `readAllNotes` change from a flat `readdir` to a recursive walk; the id→filename map becomes id→relative-path.
- A note's folder path is *not* stored in frontmatter (it's derivable from location) — keeps the file self-describing without duplicating truth.

**Graph/topology representation:** This is the design call. Options: (i) folder = a real force-simulated node with containment edges, (ii) folder = a visual cluster boundary/hull, (iii) collapsible group. Per WORKSPACE-3D ("the graph IS the workspace", tag-colored groups explicitly listed as *out of scope for now*), the minimal consistent choice:

**Folders are a soft grouping signal, not first-class graph nodes (v1).** A note's folder becomes an attribute on its `TopologyNode` (`folder?: string`). The physics uses it as a weak same-folder attraction (an optional cluster force, off by default), and the renderer can tint/hull same-folder stars later. No folder node, no containment edges — those would pollute degree counts, the wiki-link/canvas edge model, and the ghost-resolution logic, none of which know about folders.

- `topology.ts`: `TopologyNode` gains `folder?: string`; `buildTopology`/`buildLinkIndex` thread the note's folder through (needs `Note`/`GraphNode` to carry `folder`). `LinkIndex`'s `GraphNode` gains optional `folder`.
- Direct-manipulation UI (per WORKSPACE-3D's gesture table — defer detailed UX to a separate spec, but leave room): creating/moving folders is "move a star into a group" — implemented as a `moveNote(id, folderPath)` store action that renames the file into the target subdir (same atomic `rename`, map updated). No dialog. Creating a folder = dragging a star onto empty space with a modifier, or a graph context action; **flag this as UI-spec-pending** (below) — storage is ready regardless.

**This keeps folders orthogonal to the derived graph:** the graph stays "impossible to corrupt, always rebuildable from wiki-links + canvas edges" (DATA-FORMAT invariant). Folders are organizational metadata layered on top, exactly like tags.

---

## Problem 4 — Migration

Existing vaults have top-level `notes/`+`canvases/`+`vault.json` with `n_….md` opaque filenames. On opening a vault, `main.ts#setVaultPath` (or a new one-time step in the adapter's first `getMeta`) runs a **migration check**:

1. **Detect legacy layout:** `<vaultDir>/vault.json` exists AND `<vaultDir>/.astro/vault.json` does not.
2. **Move into `.astro/`:** create `.astro/`, move `vault.json`, `notes/`, `canvases/` into it (a directory `rename` per entry — atomic, instant, same volume). This is Astro moving *its own* data, not the user's — safe and unambiguous, so it's automatic. Bump `vault.json` `version`? No — layout location isn't the file format; keep `version: 1`. Record a `migratedAt`/`layout: "astro-subdir"` marker in `vault.json` settings so the check is idempotent.
3. **Rename opaque files → title-mirrored filenames:** after the move, for each `.astro/notes/n_….md`, read frontmatter title, compute `filenameForTitle`, rename. The frontmatter `id` stays `n_…` (identity preserved), so all canvas edges / AI index references survive untouched. Collisions get the ` (n)` suffix. A note whose title is empty stays `n_….md` (fallback), so no note is ever lost.

**The "don't force-migrate a manually-renamed `notes/`" caveat:** the concern is a vault where the *user* renamed the top-level `notes/` folder to something else, or put their own files at root. Our detection keys only on `vault.json` presence + a `notes/` sibling that contains `n_…`-frontmatter files. If `notes/` is absent or contains no Astro-authored notes, skip the move and just create a fresh `.astro/` — we never rename or absorb a folder we didn't author. Document in `DATA-FORMAT.md` that pre-`.astro` vaults are auto-migrated on first open by the new build.

**Reversibility / safety:** the move is `rename`s, not copies, so it's atomic and fast, but destructive to the old layout. ponytail: no backup-copy step (the data is untouched, just relocated) — but flag below whether users want a one-time backup ZIP before migrating.

---

## What changes, by file

| File | Change (description) |
|---|---|
| `packages/core` (new `vaultPaths.ts` or add to existing) | `sanitizeTitle`, `filenameForTitle(title, takenNames)` — pure, tested. `GraphNode`/`Note`(?) gain optional `folder`. |
| `packages/core/src/graph.ts` | `buildLinkIndex` threads `note.folder` onto `GraphNode`. No change to edge/ghost logic. |
| `packages/core/src/frontmatter.ts` | No change needed (id already frontmatter-sourced). Confirm `parseNote` returns frontmatter `id`. |
| `apps/desktop/src/filesystemVault.ts` | Root under `.astro/`. Recursive note walk. id→relpath map built from frontmatter. `writeNote` renames on title change + collision-suffixes. `readNote`/`deleteNote` go through map. New `rescan()` (relist + rebuild map). New `moveNote(id, folder)`. |
| `apps/desktop/src/main.ts` | Migration step in `setVaultPath` (detect legacy, move to `.astro/`, rename opaque→title files, once). New IPC: `vault:rescan`, `vault:moveNote`. Wire `BrowserWindow` `focus` → renderer rescan (or expose rescan and let renderer trigger on `visibilitychange`). |
| `apps/web/src/adapters/ipcVault.ts` | Add `rescan`/`moveNote` passthroughs (and to the `VaultAdapter` interface if shared). |
| `apps/web/src/store.ts` | On focus/visibility: call `vault.rescan()`, diff, apply external rename/edit/create/delete to `notes`/`noteList` + emit events. `updateNoteTitle` needs no change (write path renames). Add `moveNote` action. |
| `apps/web/src/graph3d/topology.ts` | `TopologyNode.folder?: string`; `buildTopology` passes it through. Optional weak same-folder cluster force (physics.ts) — off by default. |
| `packages/mcp-server/src/vaultReader.ts` | Mirror ALL of the above layout changes: `.astro/` root, recursive walk, `writeNoteFile` uses `filenameForTitle` (import from core) not `n_….md`. Must stay byte-compatible with `filesystemVault.ts`. |
| `docs/DATA-FORMAT.md` | New `.astro/` layout diagram; filename = sanitized title (not id); id lives in frontmatter and is the true identity; folders = subdirectories; migration note. |

---

## Graphify research findings (problem statement's adjacent effort)

- **Repo:** https://github.com/safishamsi/graphify (org: https://github.com/Graphify-Labs). Site: https://graphify.net/. ~94.8k GitHub stars.
- **License: dual Apache-2.0 OR MIT.** Both permissive → **reusable** (may vendor/adapt with attribution; no copyleft obligation). Verdict: **build-vs-reuse is unblocked on license grounds** — reuse is legally fine; the human still decides build-vs-reuse on fit/dependency-weight grounds.
- **What it does:** points at a folder, reads every file (code, docs, PDFs, SQL, configs, images), and emits a queryable knowledge graph. Local, deterministic AST parsing via **tree-sitter (36 grammars:** Python, TS/JS, Go, Rust, Java, C++, Ruby, C#, Kotlin, Scala, PHP, Swift, Lua, Zig, PowerShell, Elixir, Julia, Dart, plus Apex/Terraform/DreamMaker extractors**)**, **NetworkX** for graph construction, **Leiden** for community clustering. Extracts classes/functions/imports/call-graphs/docstrings/rationale comments. **No LLM, no vector store.** Distributed as a `/graphify` *skill* (slash command) for Claude Code / Cursor / Codex / Gemini CLI, not a library. Output: `graphify-out/` containing `graph.html` (interactive), `GRAPH_REPORT.md` (audit), `graph.json` (persistent, queryable). Cited efficiency: ~1.7k tokens/query vs ~123k reading raw files on a 52-file corpus.
- **Bearing on this design:** graphify walks a *real file/folder tree*. Our `.astro/`-vs-root split (problem 1) and real-directory folders (problem 3) mean Astro's user files sit as a plain walkable tree the graph-builder can consume without Astro-specific decoding — the design leaves the door open, blocks nothing. Note this repo is coincidentally the same `/graphify` skill already installed in this environment (see `graphify-out/` in repo root).

---

## Open questions / tradeoffs for the human to decide

1. **External-rename → title heuristic (problem 2b).** When a file is renamed in Explorer but its frontmatter title still says the old name, do we (a) treat the new filename as the new title and overwrite frontmatter, or (b) treat frontmatter as authoritative and just re-mirror the filename back? I lean (a) — renaming the file *is* the user's rename intent — but it can surprise a user who renamed a file not realizing frontmatter title exists. Needs a call.
2. ~~**Live watcher vs focus-rescan.**~~ **Resolved 2026-07-24**: shipped a live `fs.watch`-based
   watcher (see the "Superseded" note under problem 2 above) — real-time sync was a hard
   requirement after all, and the self-write race is now handled via a pending-save-timer guard
   in `rescanVault()`.
3. **Folder UI gestures (problem 3).** Storage (`moveNote`, recursive walk) is specified; the *graph gestures* for creating/entering/moving folders are deferred to a WORKSPACE-3D-style UI spec. WORKSPACE-3D lists tag-colored groups as out-of-scope-for-now — is folder-visualization in or out of this milestone?
4. **Migration backup.** The `.astro/` move is atomic renames (safe), no copy. Do we want a one-time export ZIP before migrating a legacy vault, for user peace of mind? Adds cost for a technically-unnecessary safety net.
5. **Duplicate-title UX.** ` (2)` suffixing keeps files distinct, but Astro's wiki-links resolve by title and `openOrCreateNoteByTitle` picks the *first* title match — two same-titled notes are ambiguous to link targeting regardless of filename. Out of scope for storage, but the product should decide whether same-title notes are allowed at all.
6. **`.astro` vs user root files.** I ruled that root-level `.md` files are user substrate (graphify fodder), not Astro notes. If the product instead wants root files to *be* editable Astro notes (Obsidian-like, where the vault root holds notes directly), the `.astro/notes` split changes — confirm the intended relationship between "Astro notes" and "arbitrary files in the vault folder."
