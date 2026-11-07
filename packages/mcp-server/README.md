# @solen/mcp-server

A standalone Node CLI that implements the [Model Context Protocol](https://modelcontextprotocol.io)
over stdio, exposing a Astro vault to any MCP-capable AI agent. It
reads the on-disk vault format described in
[docs/DATA-FORMAT.md](../../docs/DATA-FORMAT.md) — the same layout an
"Export vault" from the app produces (or, later, a filesystem vault used
directly by a desktop build).

The server reads fresh from disk on every call. It does not watch the vault
or cache anything — vaults are small, so simplicity wins.

## Install & run

```bash
# from a checkout of this repo
pnpm --filter @solen/mcp-server build
node packages/mcp-server/dist/index.js

# or, once published/linked:
solen-mcp
```

With no arguments the server follows whichever vault the Astro desktop app
currently has open, re-read on every call — so switching vaults in the app
switches what the agent sees, with no config edit and no restart.

`--vault <directory>` pins it to one vault instead. That directory must
contain an `.astro/` folder with `vault.json`, `notes/`, and `canvases/` per
the vault format.

## Client configuration

Most MCP clients read a JSON config block naming the command to launch.
A generic example:

```json
{
  "mcpServers": {
    "solen": {
      "command": "node",
      "args": ["/path/to/Solen-Canvas/packages/mcp-server/dist/index.js"]
    }
  }
}
```

## Tools

| Tool            | Input                          | Output                                                        |
|-----------------|---------------------------------|----------------------------------------------------------------|
| `list_notes`    | —                                | Every note's `id`, `title`, `tags`, `updatedAt` (no body)      |
| `read_note`     | `{ id? , title? }`               | Full note: frontmatter + Markdown body                        |
| `search_notes`  | `{ query }`                      | Matches over title + body, case-insensitive substring, each with a ±1-line snippet |
| `write_note`    | `{ title, body, id? }`           | Creates a note, or overwrites one by `id`; updates `updatedAt` |
| `list_canvases` | —                                | Every canvas's `id`, `name`, `updatedAt`                       |
| `read_canvas`   | `{ id? , name? }`                | Full `.scanvas` JSON document (nodes + edges)                  |
| `get_graph`     | —                                | The derived knowledge graph: `{ nodes, edges }`                |

`read_note` and `read_canvas` accept either an id (exact) or a title/name
(case-insensitive) — provide one.

## Resources

Every note is also exposed as an MCP resource at `solen://notes/<id>`,
returning its Markdown body with a `text/markdown` MIME type. Use `read_note`
instead when you also need the frontmatter (title, tags, timestamps).

## Security

This server has file access to one vault directory — nothing more. It reads
and writes note Markdown files under `notes/`, makes no network calls, and has
no access to canvases beyond reading them. Anyone who can talk to this process
over stdio can read every note in that vault and create or overwrite notes, so
only run it for agents you trust with that access.

Without `--vault` that directory is whichever vault the app currently has
open, so opening a different vault in Astro is what changes an agent's reach.
Pin `--vault` if you'd rather that never move.

## Development

```bash
pnpm --filter @solen/mcp-server typecheck
pnpm --filter @solen/mcp-server test
pnpm --filter @solen/mcp-server build
```

Tool handlers (`src/tools.ts`) are plain functions that take a vault
directory and typed arguments — `src/server.ts` is a thin MCP-protocol
wrapper around them, so tests exercise the tools directly against a fixture
vault (`src/__tests__/fixture-vault/`) without going through stdio.
