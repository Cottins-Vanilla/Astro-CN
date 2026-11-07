---
name: astro-brain
description: "Write the session's outcome into the Astro vault, and repair the graph. Run PROACTIVELY at the end of any task that changed code, made an architectural decision, or fixed a non-obvious bug — the user never has to ask. Also repairs broken wiki-links, orphan notes and duplicate notes. Trigger: /astro-brain, or automatically at task end."
---

# astro-brain

Writes what a working session actually produced into the vault Astro currently has open,
then repairs the graph. Runs at task end without being asked.

Sibling of [[stardust]]: that one imports a whole body of material, this one records one
session.

## 1. Reach the vault

Two routes. **Try them in this order** — the first needs no filesystem knowledge at all and
works on any machine, any OS, any user account.

### Route A — Astro's MCP server (preferred)

If an `astro` MCP server is available (Astro → Settings → Connections → Add, for this
client), use its tools and nothing else: `list_notes`, `read_note`, `write_note`,
`search_notes`, `get_graph`, `get_vault_file_graph`.

The server resolves whichever vault Astro currently has open, on every call. **No path is
configured anywhere** — the user switches vault in the app and the tools follow.

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

Notes live in `<currentVaultPath>/.astro/notes/**.md`. Subfolders are allowed and become
the note's folder. Expand the environment variables at runtime — never hardcode a home
directory, a username, or a drive letter into this skill or into anything it writes.

Config missing, unreadable, or `currentVaultPath` absent → **do nothing and say so.** Never
guess a vault path, never fall back to `recentVaults[0]`, never create a vault.

### Check the vault matches the work before writing

The open vault is whatever the user last opened, which may have nothing to do with the
project this task touched — a session about a web app does not belong in a recipe vault. If
the vault's existing notes are plainly about a different subject, write nothing and say
which vault was open instead. Ask before crossing subjects; never silently pick a different
vault from `recentVaults`.

## 2. Note format

Plain markdown. **No frontmatter** — Astro adopts an external `.md` on load, mints it a
stable `id` and takes the title from the filename (a file with no frontmatter is minted,
and on rename the filename always wins over a frontmatter title). Writing frontmatter by
hand risks colliding with an existing id.

- Filename = note title + `.md`. Title is the identity; keep it stable.
- Links are `[[Title]]` or `[[Title|alias]]`, resolved **case-insensitively by title**. A
  link with no matching note does not error — it becomes a **ghost node** in the graph.
  Ghost nodes are the visible symptom of a broken link.
- Dates `YYYY-MM-DD`.
- Astro's vault watcher picks up file changes live. No restart, no app interaction needed.

## 3. What to write

| Note | Rule |
|---|---|
| `Session YYYY-MM-DD.md` | One per day. **Append** a section for this task — never overwrite an existing day. |
| `<Project>.md` | The project actually touched. Update Status / Decisions / Known issues in place. |
| `Index.md` | Hub. Links to every session note and every project note. |

Session entry shape — short, factual, no narration:

```markdown
## <task, one line>

- **Changed:** files/areas
- **Decision:** what was chosen and *why* (skip if none)
- **Broke / fixed:** root cause, not symptom (skip if none)
- **Next:** open threads (skip if none)

Links: [[<Project>]]
```

**Hard rule: no orphans.** Every note written must be reachable — link it from `Index` or
from the project note in the same pass that creates it. A note added without an inbound
link is a bug.

## 4. Coherence pass — every run, after writing

1. **Broken links.** Collect every `[[target]]` across the vault's notes. Any target with
   no matching note title (case-insensitive) is broken. Fix by *either* correcting the
   spelling to the note that was clearly meant, *or* creating the missing note with a real
   stub. Never delete the link to make the warning go away.

   **Except deliberate ghost links.** A dangling link is intentional when the surrounding
   text says so ("not written yet", "renders as a ghost link"), when the note is seed or
   demo content, or when it is an obvious someday-placeholder. Astro renders unresolved
   links as ghost nodes on purpose — that is a feature, not a defect. Read the sentence
   around the link before touching it. The seed vault ships exactly such a link, and
   "fixing" it silently deletes the demonstration.
2. **Orphans.** Notes with zero inbound links. Link them from `Index` under the right
   heading. Do not delete a note to fix an orphan.
3. **Duplicates.** Same or near-same title (`Session 2026-07-28` vs `session 2026-07-28`,
   `Astro` vs `Astro Project`). Merge into the one with more inbound links, delete the
   other, and repoint every link that named the deleted title.
4. Report counts: `n links fixed, n orphans linked, n duplicates merged`. Zero is a valid
   and common result — say `vault coherent` and stop.

## 5. Never write into the vault

API keys, tokens, `.env` contents, OAuth client secrets, passwords, credentialed URLs, or
the contents of any file matched by the repo's `.gitignore`. A project path is fine when it
is genuinely part of the record; a secret never is — reference the file that holds it
instead of pasting it.

## 6. When NOT to run

- The turn changed no files (pure question, explanation, code reading).
- The change is trivial: a typo, a formatting fix, a version bump.
- The user explicitly said not to.
- A run today already recorded this exact task — update that entry instead of adding a
  second one.

Silence is correct in those cases. Do not write a note saying nothing happened.
