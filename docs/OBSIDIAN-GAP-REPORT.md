# Obsidian → Astro gap report

Point-in-time report, written before the tab-workspace and title-bar-overlay
removal landed. A few rows below note where a gap has since closed; the rest
of the "Astro today" column reflects the state at time of writing, not
necessarily today's `main`.

Sources: (V) = user's screen recording `attachs/video_funzionamento_obsidian.mp4`
(Obsidian 1.12.7, Italian locale) — Settings dialog opened ~08:07, walked
General→Editor→Files&Links→Appearance→Hotkeys→Secrets→Core plugins→Community
plugins through ~09:53, plus Web Viewer plugin settings and vault
switcher/new-tab UI at ~10:49–11:20, and graph-view Filters/Groups/
Appearance/Forces panel at ~07:23. (D) = official docs, `help.obsidian.md/settings`.
Astro surface read from `docs/WORKSPACE-3D.md`, `ARCH-TAB-WORKSPACE.md`,
`ARCH-APPEARANCE.md`, `SettingsModal.tsx`, `GraphSettingsPanel.tsx`,
`CommandPalette.tsx`.

## General (Informazioni)

| Obsidian setting | What it does | Astro today | Fit |
|---|---|---|---|
| Version / check for updates (V,D) | Shows app+installer version, manual update check | none | doesn't map — Electron auto-update is a build/release concern, not a settings-UI feature |
| Auto-updates toggle (V) | Background update checks | none | needs adaptation — ties to Electron's own updater, not a UI setting |
| Language picker, 30+ locales (V,D) | Switches whole UI language | none (English only) | needs adaptation — real i18n effort, not a toggle |
| Account / license (Catalyst, commercial) (V) | Obsidian's own monetization | none | doesn't map — no equivalent business model in Astro |
| "Notify if startup takes longer than expected" (V) | Startup diagnostics | none | doesn't map — niche perf-support feature |
| "Command line interface" toggle (V) | Lets OS shell interact with the app | none | doesn't map — no CLI surface today |

## Editor

| Obsidian setting | What it does | Astro today | Fit |
|---|---|---|---|
| "Always open in new tab" (V) | New-tab-on-link-click default | **closed since** — the tab strip shipped (ARCH-TAB-WORKSPACE.md); every link opens its own tab today | natural — now just a default-behavior toggle over an existing tab strip |
| Default new-tab view / default edit mode (Preview vs Source) (V,D) | Reading vs editing default | Astro's editor has one mode (no reading/source split noted) | doesn't map today — Astro's note surface isn't split into read/edit modes |
| Editor state in status bar (V) | Shows/toggles current edit mode | n/a (no modes) | doesn't map |
| Readable line length (V) | Caps line width for readability | none — NoteEditor width unknown | natural — cheap CSS max-width toggle |
| "Don't show line breaks" (strict Markdown line breaks) (V) | Markdown line-break spec compliance | none | natural — small renderer flag |
| Show properties as "Visible"/"Code" (YAML) toggle (V) | Frontmatter display mode | none — Astro's note model/properties unclear | needs adaptation — depends on whether Astro notes have frontmatter properties UI |
| Fold headings / fold indentation lists (V) | Collapsible headings & lists in editor | none | natural — common CodeMirror/editor feature, self-contained |
| Line numbers (V) | Editor gutter line numbers | none | natural — one editor-config flag |
| Indent guides (V) | Vertical list-indent guide lines | none | natural |
| RTL text direction (V) | Per-note or global RTL | none | needs adaptation — real i18n/RTL layout work |
| Spellcheck + language (V) | Native spellcheck in editor | none | natural — Chromium/Electron spellcheck is close to free |
| Auto-pair brackets/quotes (V) | Auto-closes ( [ { " ' | none | natural — small editor behavior |
| Auto Markdown syntax pairing (bold/italic) (V) | Wraps selection when typing * or _ | none | natural |
| Smart list indentation (V) | Auto-manages list markers on indent | none | needs adaptation — depends on Astro's Markdown editing engine |
| Use tabs / tab size (V) | Indentation character + width | none | natural |
| Auto-convert pasted HTML → Markdown (V) | Paste-and-clean from web pages | none | needs adaptation — meaningful only once rich paste is a feature |
| Vim keybindings (V) | Full vim mode in editor | none | needs adaptation — nontrivial, editor-dependent, niche audience |

## Files & Links

| Obsidian setting | What it does | Astro today | Fit |
|---|---|---|---|
| Default file to open at startup (V) | "Last opened" vs specific note | none | natural — small store flag |
| New-note location + custom folder (V) | Where created notes land | Astro has folders (per CLAUDE context) but no configurable "new note folder" seen in SettingsModal | natural — fits existing folder model |
| New-attachment location + folder (V) | Where dropped images/files land | none — Astro has no attachment concept yet (noted explicitly as out-of-scope in GraphSettingsPanel.tsx comment) | doesn't map today — Astro has no attachments |
| New-link format (shortest path / relative / absolute) (V) | How auto-generated `[[links]]` are written | Astro creates structural edges directly, not text links (WORKSPACE-3D.md) | doesn't map — Astro's "draw a line" model bypasses text-link generation entirely |
| "Automatically update internal links" on rename (V) | Rewrites `[[links]]` vault-wide on file rename | Unclear — wiki-links exist but rename-safety unconfirmed | needs adaptation — depends on Astro's own rename-note logic |
| "Use Wikilinks" toggle (Markdown vs wiki format) (V) | New links written as `[[x]]` vs `[x](x.md)` | Astro always uses wiki-links style, no Markdown-link option | needs adaptation — minor, low value given edges-not-links model |
| Detect all file extensions (V) | Lets non-Markdown files be linked/browsed | none | doesn't map — no non-note file browsing in Astro |
| Confirm before deleting (V) | Delete confirmation toggle | Astro already confirms delete unconditionally (WORKSPACE-3D.md "Select + Delete... confirm first") | full — already stricter than Obsidian's optional toggle |
| Delete-attachments-with-file policy (V) | Ask/always/never on note delete | doesn't map (no attachments) | doesn't map |
| Deleted-file destination (system trash vs `.trash`) (V) | Where deleted notes go | Unclear if Astro has recoverable trash | needs adaptation — worth a look given filesystem-vault sync (project memory) |
| Excluded files list (V) | Hides folders (e.g. `.obsidian`, build output) from quick switcher/graph | GraphSettingsPanel has "Existing notes only" but no path-exclusion list | natural — small settings-driven filter, reuses existing filter plumbing |
| Custom config folder (V) | Alternate `.obsidian`-equivalent folder name | Astro already uses `.astro/` fixed convention (project memory) | doesn't map — no need, not user-facing today |
| Enable callback URI (x-callback-url) (V) | Lets OS URIs drive Obsidian actions | none | doesn't map — no external URL-scheme integration today |
| Rebuild vault cache (V) | Manual reindex button | Astro has live filesystem watcher (project memory) already, likely no stale-cache issue | doesn't map — different sync architecture |

## Appearance

| Obsidian setting | What it does | Astro today | Fit |
|---|---|---|---|
| Base theme (dark/light/system) (V,D) | Global theme | full — dark/light exists; no "system" auto option | needs adaptation — small addition: `prefers-color-scheme` follow mode |
| Accent color (swatch + full RGB picker) (V,D) | Tints buttons/links | full — presets + `<input type=color>` (ARCH-APPEARANCE.md) | full |
| Community themes browser (604 themes, install/search/filter, dark-only filter) (V) | Full theme marketplace | none — no theme package system | doesn't map — no community distribution channel exists; would need real infra |
| Inline title toggle (V) | Note title editable inline vs hidden | Unclear if Astro's NoteEditor has this toggle | needs adaptation — small, depends on NoteEditor's title handling |
| Tab title bar toggle (V) | Per-tab title header show/hide | tab strip shipped (ARCH-TAB-WORKSPACE.md), titles always shown, no hide toggle | needs adaptation — small addition over the now-existing strip |
| Ribbon show/hide + "configure ribbon" button-picker (V) | Toggle + customize the left icon rail | none — Astro's sidebar/ribbon icons are fixed | natural — a reorder/hide list over the existing fixed ribbon items |
| Interface font / text font / monospace font pickers (V) | Font family for chrome / editor / code | none (docs/ARCH-APPEARANCE.md explicitly scopes font pickers out) | doesn't map today — deliberately deferred already |
| Font size slider + "quick font adjust" (Ctrl+scroll) (V) | Editor/preview font scale | none (uiZoom scales whole UI, not just text) | needs adaptation — Astro's uiZoom is a superset (whole-UI zoom); a text-only size control is a smaller, separate control |
| Interface zoom slider (V,D) | Scales the whole UI | full — `settings.ui.uiZoom` 0.8–1.3 (ARCH-APPEARANCE.md) | full |
| Native menus toggle (V) | OS-native vs themed menu bar | none | doesn't map — Astro likely has no traditional menu bar to toggle |
| Window frame style (hidden/native) (V) | Title bar chrome style | **closed since** — Astro's native `titleBarOverlay` was removed; the app now draws its own themed minimize/maximize/close buttons (`WindowControls.tsx`) | doesn't map — no native/hidden choice left to expose, the buttons are always Astro's own |
| Custom app icon (V) | Replace taskbar/dock icon | none | doesn't map — cosmetic, low value |
| Hardware acceleration toggle (V) | GPU rendering on/off | none | needs adaptation — meaningful for Astro given the WebGL graph is the whole app; a "disable GPU" escape hatch could matter more here than in Obsidian |
| CSS snippets folder (V) | User CSS injection | none | doesn't map — no snippet/plugin CSS pipeline; explicitly out of scope (ARCH-APPEARANCE.md) |

## Hotkeys

| Obsidian setting | What it does | Astro today | Fit |
|---|---|---|---|
| Searchable list of ~193 commands with add/remove keybinding per command (V,D) | Full hotkey remapping UI | none — Astro's shortcuts (Ctrl+G, Ctrl+B, Ctrl+K, etc.) are hardcoded in components | needs adaptation — real feature: a commands registry + rebind UI, sizable but valuable since Astro already has a growing hardcoded shortcut list |

## Core plugins (Obsidian's built-in feature modules)

| Obsidian core plugin | What it does | Astro today | Fit |
|---|---|---|---|
| Vista grafo (Graph view) (V) | The graph pane | full — graph *is* the app (WORKSPACE-3D.md) | full |
| Anteprima pagina (Page preview / hover preview) (V) | Hover a link → popup preview of the note | none | natural — fits the existing note model, no new data needed |
| Aree di lavoro (Workspaces) (V) | Save/restore whole panel layouts | none — Astro's floating-dock layout is fixed | needs adaptation — meaningful once more panel configurations exist |
| Base (Bases — note-property databases/table views) (V) | Turns frontmatter properties into filterable/sortable table views | none | doesn't map today — Astro has no structured note-properties system to project into a table |
| Collegamenti in uscita (Outgoing links / unlinked mentions) (V) | Panel of a note's outbound links + unlinked-mention suggestions | Astro shows "Connected"/backlinks in fixture data but unlinked-mentions unclear | needs adaptation — outgoing side of what Astro likely already has inbound |
| Comandi Slash (V) | `/` slash-commands while typing | none | natural — same command list the Command Palette already has, different trigger |
| Conteggio parole (Word count) (V) | Word/char count in status bar | NoteEditor already shows counts per fixture data seen in video's own vault UI, but unclear if Astro's own editor does | needs adaptation — cheap if not present |
| Diapositive (Slides) (V) | Turns a note into a `---`-delimited slideshow | none | doesn't map — orthogonal feature, no evidence of demand |
| Esplora risorse (File explorer) (V) | The classic folder tree | Astro's sidebar already lists notes/folders | full (Astro's sidebar covers this) |
| Gestione note (Note composer: merge/split/reformat) (V) | Merge two notes, extract selection to new note | none | needs adaptation — valuable but nontrivial given Astro's edges-as-data model (merging notes means merging their graph edges too) |
| Lavagna (Canvas) (V) | Freeform whiteboard combining notes/text/cards | Astro keeps `.scanvas` format for data/export but removed the 2D canvas surface (WORKSPACE-3D.md) | doesn't map — deliberate divergence, already decided against |
| Modelli (Templates) (V) | Insert boilerplate from a template file | none | natural — self-contained, common request |
| Note casuali (Random note) (V) | Opens a random note | none | natural — one command, trivial |
| Note del giorno (Daily notes) (V) | Auto-create/open today's dated note | none | natural — well-scoped, common workflow |
| Note univoche (Unique note creator, Zettelkasten timestamps) (V) | Timestamp-prefixed note IDs | Astro's notes already use generated ids (`n_alpha` etc per fixture) | doesn't map — different, already-adequate id scheme |
| Pannello etichette (Tag pane) (V) | Sidebar list of all tags + counts | none — no visible tag system in Astro's current surface | needs adaptation — depends on whether Astro has/plans a tag concept |
| Publish (V) | Obsidian's paid static-site hosting | none | doesn't map — different business model |
| Recupero file (File recovery / snapshots) (V) | Periodic local snapshots for accidental-loss recovery | Astro has git-friendly filesystem vault + live sync (project memory) but no built-in snapshot browser | needs adaptation — safety-net feature, valuable given real user data lives in these vaults |
| Registratore audio (Audio recorder) (V) | Record audio, attach to note | none (no attachment concept) | doesn't map |
| Ricerca (Search) (V) | Full-vault keyword search with saved queries; shown live in video filtering by `tag:#agent` | Command Palette does fuzzy note-title search only, not full-text or tag search | needs adaptation — real gap: no full-text search across note bodies today |
| Riferimenti (Backlinks, count in status bar) (V) | Shows/links a note's backlinks | Astro's fixture vault shows "Connected"/"Mentioni sconosciute" panel already | full-ish (equivalent panel exists in the data model shown) |
| Riquadro comandi (Command palette) (V) | Ctrl+P fuzzy command runner | full — Astro's own Ctrl+K CommandPalette.tsx | full |
| Segnalibri (Bookmarks) (V) | Pin notes/searches/headings for quick access | none | natural — small, standalone list feature |
| Selezione rapida (Quick switcher) (V) | Fast fuzzy file-jump, Ctrl+O | Astro's Command Palette already includes "Open note: X" entries for every note | full (folded into the Command Palette already) |
| Strumento importazione Markdown (V) | Import notes from other apps' export formats | Astro has ZIP export/import (per CLAUDE context) but not third-party-app import | doesn't map — different import surface (vault-to-vault vs external-app-to-vault) |
| Struttura (Outline) (V) | Heading outline of current note | none | natural — cheap, parses existing Markdown headings |
| Sync (V) | Obsidian's paid E2E cloud sync | Astro has live filesystem sync instead (project memory) | doesn't map — different sync architecture already chosen |
| Vista note a piè di pagina (Footnotes view) (V) | Panel listing footnotes in current note | none | doesn't map — niche, low value |
| Vista proprietà (Properties view) (V) | Structured frontmatter editor UI | none | needs adaptation — depends on whether Astro notes gain structured properties |
| Visualizzatore web (Web viewer) — plugin-level settings (V) | Open-externally toggle, homepage, save-pages-as-markdown folder, search engine picker, **ad-block with subscribed block-list URLs + refresh interval**, clear-viewer-data button | Astro has an in-app browser as tabs in the workspace strip (`WebToolbar.tsx`/`WebViewport.tsx`, WORKSPACE-3D.md/ARCH-TAB-WORKSPACE.md) but none of: search-engine choice, ad-block, save-as-markdown, homepage setting | needs adaptation — Astro's browser infra exists; ad-block + save-page-as-note are the two genuinely new asks here |

## Graph view (Vista grafo panel: Filtri / Gruppi / Aspetto / Forze)

| Obsidian setting | What it does | Astro today | Fit |
|---|---|---|---|
| Filters: search, existing-files-only, orphans (V) | Same shape as Astro's | full — GraphSettingsPanel.tsx Filters section matches | full |
| **Groups** (color nodes matching a query) (V) | Assign colors to nodes matching search/tag rules | none — explicitly deferred (GraphSettingsPanel.tsx comment: "no Groups section (deferred, see Phase 18 plan)") | needs adaptation — already scoped as future work, not a new discovery |
| Display/"Aspetto": node size, line thickness/opacity, arrows, text fade | Same shape | full — Display section matches almost 1:1 | full |
| Forces: center force, repel force, link force, link distance | Same shape | full — Forces section matches almost 1:1 | full |
| Attachments filter | Hide attachment-type nodes | doesn't map (no attachments) | doesn't map |

## Top 10 by value-for-effort

1. **Full-text search across note bodies** (Core plugins: Ricerca) — Astro only has title-fuzzy search today; this is the single biggest functional gap visible in the video.
2. **Hotkey rebind UI** — Astro already hardcodes a growing shortcut list (Ctrl+G/B/K/T/W); externalizing to a searchable, rebindable table is natural and high-leverage.
3. **Daily notes** (Core plugins) — small, self-contained, common workflow, no architecture change.
4. **Templates** (Core plugins) — same: small, standalone, clear user value.
5. **File recovery / snapshots** — safety net that matters more for Astro's real-data vaults (project memory: "re-website is a real live test vault") than for a toy app.
6. **Excluded-files list** (Files & Links) — cheap, reuses the existing Filters plumbing already in GraphSettingsPanel.
7. **Ribbon configure (reorder/hide icons)** (Appearance) — small UI, reuses Astro's existing fixed ribbon.
8. **Outline panel** (Core plugins: Struttura) — trivial to build (parses headings already in the Markdown), useful for long notes.
9. **Page/hover preview** (Core plugins: Anteprima pagina) — fits Astro's existing note model with no new data, nice affordance for the "click a star to open" flow.
10. **Ad-block + save-page-as-Markdown for the in-app browser** (Web viewer plugin settings) — Astro's browser infra (`WebToolbar`/`WebViewport`, ARCH-TAB-WORKSPACE.md) already exists; these are incremental additions.

Explicitly **not** recommended: community themes marketplace, Obsidian Sync/Publish/Catalyst (different business model/architecture already chosen), Canvas (deliberately removed), Bases/Properties view (no structured-properties system to hook into yet), Vim mode, RTL/i18n (large standalone efforts, not gaps in kind).
