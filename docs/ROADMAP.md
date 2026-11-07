# Roadmap

## Shipped — v0.1 + v0.2

A usable local-first canvas workspace, in the browser and as a native desktop
app.

- [x] Architecture, data format, and repository structure defined
- [x] **Infinite canvas** — pan/zoom, create/drag/resize nodes, connect with edges
- [x] **Node types** — note, text, link, group (+ plugin-registered types)
- [x] **Markdown notes** — CodeMirror editor, frontmatter, live preview in node cards
- [x] **Wiki-links** — `[[Title]]` linking with autocomplete and ghost notes
- [x] **Knowledge graph** — derived link index, force-directed graph view
- [x] **Constellation Mode** — star-chart layout; clusters snap onto named
      constellation patterns (Orion, Cassiopeia, the Big Dipper, …) when
      their shape fits, falling back to a generic asterism otherwise
- [x] **Local vault** — IndexedDB persistence behind `VaultAdapter`; export/import as a plain folder (ZIP)
- [x] **Command palette** — keyboard-first navigation and actions
- [x] **Themes** — dark and light, switchable, plugin-extensible
- [x] **Plugin API** — commands, node types, panels, events; one example plugin shipped
- [x] **AI panel** — provider-agnostic chat over the vault (bring-your-own-key, OpenAI-compatible local runtimes)
- [x] **MCP server** — expose a vault to external AI agents via the Model Context Protocol
- [x] **Desktop app** (`apps/desktop`) — Electron build with a filesystem `VaultAdapter`: the vault is literally a folder on disk, edits auto-save
- [x] **Vault switcher** — multiple vaults, switch between them without leaving the app
- [x] **File watching** — external edits/renames to a vault's files (or its folder structure) are picked up live, no restart needed
- [x] **MCP client connections** — Settings → Connections wires the MCP server into locally installed AI agents' own config files

## Next up

(nothing currently queued — see v0.3 below)

## v0.3 — Ecosystem

- Plugin manager UI + community plugin registry
- Theme gallery
- Public plugin API frozen at 1.0 (semver)

## v0.4 — Sync (optional, opt-in)

- First-party encrypted sync service as a `VaultAdapter` implementation
- Conflict resolution designed for offline-first usage

## Later

- Mobile companion
- Real-time collaboration
- Publishing (share a canvas or note as a static page)

Dates are intentionally absent: scope is ordered, not scheduled.
