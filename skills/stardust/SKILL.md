---
name: stardust
description: "Turn any folder — a codebase, a docs tree, a pile of papers and notes — into a knowledge graph that lives INSIDE your Astro vault, as real notes and real wiki-links, so the 3D sky is the visualization. Then answer questions by walking that graph instead of grepping. Trigger: /stardust"
---

# stardust

Raw material in, stars out.

[graphify](https://graphify.com/) turns a repo into a knowledge graph an AI queries instead
of grepping, and renders it to a `graphify-out/` folder (HTML + JSON + report). Astro
already **is** that renderer: notes are stars, wiki-links are edges, the vault is an open
Markdown format on your own disk. So this skill drops the output layer entirely and writes
the graph as vault content — the payoff is a graph you can navigate, edit and link the
moment it exists, instead of a dead artifact sitting beside the repo.

Kept from graphify: the extraction pipeline, the **audit trail** (every edge tagged
EXTRACTED / INFERRED / AMBIGUOUS), **clustering**, **hub nodes**, **incremental update**.
Dropped: `graphify-out/`, the HTML viewer, the standalone `graph.json`, the separate query
engine — Astro's own MCP server is the query engine.

Sibling of [[astro-brain]]: that one records *what happened this session*, this one imports
*a body of material*. Both write into the same vault and both obey §1.

## Usage

```
/stardust <path>                 # extract <path> into the open vault
/stardust <path> --update        # incremental: only new/changed files
/stardust <path> --deep          # richer INFERRED edges (slower, more passes)
/stardust <path> --dry-run       # report what it would write, write nothing
/stardust query "<question>"     # walk the graph, answer with file:line citations
/stardust audit                  # re-verify links, list orphans/dupes/dead edges
```

No path given → `.` (current directory). Never ask the user for a path.
`--help` → print the Usage block verbatim and stop.

## 1. Reach the vault

Two routes. **Try them in this order** — the first needs no filesystem knowledge at all and
works on any machine, any OS, any user account.

### Route A — Astro's MCP server (preferred)

If an `astro` MCP server is available (Astro → Settings → Connections → Add, for this
client), use its tools and nothing else:

| Tool | Use |
|---|---|
| `list_notes` | what already exists |
| `read_note` | read one |
| `write_note` | create/update one |
| `search_notes` | find entry points |
| `get_graph` | note-level topology |
| `get_vault_file_graph` | file-level topology |

The server resolves whichever vault Astro currently has open, on every call. **No path is
configured anywhere** — the user switches vault in the app and the tools follow. This is
the route to use.

### Route B — filesystem fallback

Only when no `astro` MCP server is reachable. Astro's desktop config records the open
vault; its location follows the OS convention Electron's `app.getPath("userData")` uses for
the app name `@solen/desktop`:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\@solen\desktop\desktop-config.json` |
| macOS | `~/Library/Application Support/@solen/desktop/desktop-config.json` |
| Linux | `$XDG_CONFIG_HOME/@solen/desktop/desktop-config.json` (`~/.config/...` if unset) |

```json
{ "currentVaultPath": "<absolute path to the vault folder>", "recentVaults": ["..."] }
```

Notes live in `<currentVaultPath>/.astro/notes/**.md`. Expand the environment variables at
runtime — never hardcode a home directory, a username, or a drive letter into this skill or
into anything it writes.

Config missing, unreadable, or `currentVaultPath` absent → **do nothing and say so.** Never
guess a vault path, never fall back to `recentVaults[0]`, never create a vault. Say which
route you used in your report.

### Confirm before the first write

An import can add hundreds of notes to a vault the user opened for something else. State
the vault, the corpus path and the estimated note count, and get a yes before writing.
`--dry-run` does the estimate without asking. If the vault's existing notes are plainly
about a different subject than the corpus, stop and say so rather than cross-posting.

## 2. What a node is

One note per **meaningful unit**, not per file. Files are containers; nodes are ideas.

| Corpus | Node | Skip |
|---|---|---|
| Code | module, exported class/function, config surface, entry point | tests, generated, vendored, lockfiles |
| Docs | one document, or one H2 section if the doc is long | changelogs, licenses |
| Papers/notes | one paper, one claim, one concept named ≥2× across files | boilerplate |

A unit that appears in exactly one file and is referenced nowhere else is not a node — it
is a line in its parent's note. Ruthlessness here is what keeps the sky readable.

## 3. Note format (Astro's rules, not Obsidian's)

Plain Markdown, **no frontmatter** — Astro adopts an external `.md`, mints a stable `id`
and takes the title from the filename. Hand-written frontmatter risks colliding with an
existing id.

- Filename = title + `.md`. Title is identity; keep it stable across `--update` runs.
- Links are `[[Title]]` / `[[Title|alias]]`, resolved **case-insensitively by title**.
- Put every node under `.astro/notes/Stardust/<corpus-slug>/`, so an import is one folder
  the user can delete in one gesture. Clusters (§5) become subfolders of that.

Body shape:

```markdown
One sentence: what this is, in plain language.

## Where
`src/auth/session.ts:42-118`

## Links
[[Token Store]] <!-- EXTRACTED: imports -->
[[Login Flow]] <!-- EXTRACTED: called by -->
[[Rate Limiter]] <!-- INFERRED: both mutate the same Redis key -->
```

The `## Links` section is the edge list — Astro reads it as graph edges, and the HTML
comment carries the audit tag without polluting the rendered note.

**Every edge carries a tag. No tag = the edge is not allowed to exist.**

- `EXTRACTED` — read directly out of the source (an import, a call, an explicit citation).
  Name the evidence after the colon.
- `INFERRED` — you concluded it. Name the reasoning in one clause.
- `AMBIGUOUS` — plausible but unconfirmed. These are what the user reviews first.

Never write an untagged link, and never upgrade INFERRED to EXTRACTED without re-reading
the source.

## 4. Pipeline

1. **Scope.** Walk the path. Respect `.gitignore`. Exclude `node_modules`, build output,
   `.git`, binaries, anything over ~200 KB. Report the file count before extracting.
2. **Extract.** Read files, emit nodes per §2 with EXTRACTED edges only. Invents nothing.
3. **Infer.** Second pass over the node set: shared state, parallel naming, "these two are
   the same concept under different names", lifecycle ordering. INFERRED / AMBIGUOUS only.
   `--deep` widens this pass; without it, stay conservative.
4. **Cluster** (§5).
5. **Write.** Notes into the vault, then the two reports (§6).
6. **Verify.** Run `audit` (§7) on your own output before declaring done.

Astro's filesystem watcher picks the new files up live — no restart, no import step.

## 5. Clusters and hubs

This is graphify's "community detection", renamed: in graph terms a *community* is a set of
nodes that link to each other far more than to the rest of the graph. Nothing to do with
people, and "community" collides with Astro's own Constellation Mode vocabulary, so:
**cluster**.

- Find clusters by edge density, not by folder — the point is to surface structure the
  directory layout does **not** already show. Name each for what it *does* ("Session &
  Auth"), never "Cluster 3". Each becomes a subfolder plus one index note linking its
  members.
- **Hub** (graphify's "god node") = a node in the top ~5% by degree. Mark it with a
  `> Hub — N connections` callout at the top of its body. Hubs are where a newcomer starts
  reading and where a refactor hurts most; say which.
- **Cross-cluster edges are the interesting ones.** The report (§6) leads with them — that
  is the whole reason to build this rather than read the files in order.
- If Constellation Mode suits this corpus, say so and name the clusters that would map to
  patterns. Do not hand-write `.scanvas` files.

## 6. Two reports, both notes in the vault

- `Graph report — <corpus>.md` — plain language, for a human. Clusters, hubs, cross-cluster
  surprises, what to read first. Links every cluster index.
- `Graph audit — <corpus>.md` — the honest one. Counts of EXTRACTED / INFERRED / AMBIGUOUS,
  every AMBIGUOUS edge listed with its reasoning, files skipped and why, anything
  unresolved. **No silent truncation:** a cap at N files or a dropped directory is named
  here.

Both link back to the corpus index note. Never leave an orphan.

## 7. `query` and `audit`

**query** — do not grep.

1. `search_notes` to find entry points.
2. `get_graph` for note-level topology, `get_vault_file_graph` for file-level.
3. Walk outward breadth-first from the entry points, `read_note` on each hop.
4. Answer as an explicit path — `[[A]] → [[B]] → [[C]]` — carrying the `## Where` file:line
   citations of the notes you crossed. An answer with no path and no citation is a guess;
   say that instead of dressing it up.

On Route B, read `.astro/notes/**` directly and say so.

**audit** — over the corpus folder: wiki-links pointing at no note (create it or drop the
link — decide, don't ask twice), notes with zero links in and out, near-duplicate titles,
and edges whose evidence no longer exists in the source. Fix what is mechanical, list what
needs judgement.

## 8. `--update`

Compare source mtimes against the last run (recorded in the audit note). Re-extract only
changed files. Then: delete notes whose source unit is gone, re-tag edges whose evidence
moved, and leave every note the user has since edited by hand **alone** — an import must
never overwrite human writing. If a hand-edited note's source changed, append a
`> Source changed, review` callout instead of rewriting it.

## 9. Never write into the vault

API keys, tokens, `.env` contents, OAuth client secrets, passwords, credentialed URLs, or
the contents of any file matched by the corpus's `.gitignore`. Reference the file that
holds a secret; never paste it to "document" it.

## When NOT to run

- The open vault is about a different subject than the corpus (§1) — say which vault is
  open and stop.
- The corpus is under ~10 files. A graph of 8 nodes is a list; just read them.
- The user asked one question about a codebase. Answer it — building a graph to answer a
  single question costs more than the answer is worth.
