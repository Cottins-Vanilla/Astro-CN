# Astro agent skills

Two skills that teach an AI coding agent to use an Astro vault as memory. They are plain
Markdown — no install step, no runtime, no dependency.

| Skill | What it does |
|---|---|
| [`astro-brain`](astro-brain/SKILL.md) | Writes the outcome of a working session into the open vault, then repairs broken links, orphans and duplicates. |
| [`stardust`](stardust/SKILL.md) | Turns a folder — a codebase, a docs tree, a pile of papers — into a graph of notes and wiki-links inside the vault, so Astro's 3D sky is the visualization. |

## How they reach your vault

**Preferred: the MCP server.** Open Astro → **Settings → Connections**, find your agent
(Claude Code, Claude Desktop, Codex/ChatGPT, Cursor, Antigravity, Goose) and press **Add**,
then restart it. The agent gets `list_notes`, `read_note`, `write_note`, `search_notes`,
`get_graph` and `get_vault_file_graph`, all pointed at whichever vault Astro currently has
open — no path is written into any config, so switching vault in the app just works. See
[docs/MCP.md](../docs/MCP.md).

**Fallback: the filesystem.** Without MCP, the skills read Astro's own
`desktop-config.json` for `currentVaultPath`, at the standard per-OS location
(`%APPDATA%\@solen\desktop\` on Windows, `~/Library/Application Support/@solen/desktop/` on
macOS, `$XDG_CONFIG_HOME/@solen/desktop/` on Linux). Notes are
`<vault>/.astro/notes/**.md`.

Neither route contains a hardcoded path. Nothing here is specific to one machine or one
user account.

## Installing

### Claude Code

Copy (or symlink) the folders into your skills directory:

```sh
# macOS / Linux
mkdir -p ~/.claude/skills
cp -r skills/astro-brain skills/stardust ~/.claude/skills/
```

```powershell
# Windows
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Copy-Item -Recurse skills\astro-brain, skills\stardust "$env:USERPROFILE\.claude\skills\"
```

Then `/astro-brain` and `/stardust` are available in any project.

To make them repo-local instead, copy them into that repo's `.claude/skills/`.

### Other agents

`SKILL.md` is prose with a YAML header — any agent that accepts a Markdown instruction file
can use it. Goose reads skills from its own skills directory; Cursor and Codex can take the
file as a rule/instruction document. The content assumes nothing beyond "you can read and
write files, or call the `astro` MCP tools".

## Writing your own

The two rules that matter, both learned the hard way:

1. **Never hardcode a path.** No `C:\Users\you`, no `/home/user`, no drive letters.
   Resolve `%APPDATA%` / `$XDG_CONFIG_HOME` at runtime, or skip the filesystem entirely and
   use MCP. The repo's `pnpm check:paths` enforces this for source; skills are held to the
   same standard.
2. **Never write a secret into the vault.** Reference the file that holds it.
