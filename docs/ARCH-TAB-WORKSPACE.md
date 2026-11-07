# ARCH: Obsidian-style Tab Workspace

Build spec. Replaces the floating in-app browser card (`BrowserPanel.tsx`) with a
tab strip at the top of the main content area. The 3D graph is the permanent
first tab ("Vista grafo"); web pages and new-tab pages open as sibling tabs.

**Reuse, don't rebuild.** The Electron main-process browser infra
(`apps/desktop/src/browserTabs.ts`, `window.browserAPI`) is solid and stays
**untouched** — one `WebContentsView` per web tab, bounds-synced from a renderer
div's `getBoundingClientRect()`. Only the renderer changes: the strip that used
to live inside `BrowserView` moves up to span the whole content area and gains a
pinned graph tab.

---

## 1. Tab model (renderer / store)

```ts
type TabKind = "graph" | "web" | "newtab";
interface WorkspaceTab {
  id: string;            // "graph" | "nt-<n>" for newtab | the native browserTabs id for web
  kind: TabKind;
  title: string;         // web: synced from browserAPI "updated" events; graph: "Graph"; newtab: "New tab"
}
```

- **Graph tab is permanent, always index 0, not closable.** Losing the graph =
  losing the app's one surface (docs/WORKSPACE-3D.md). Obsidian lets you close
  everything; Astro does not — the graph tab has no close button and `closeTab`
  refuses it. This is the one deliberate divergence from Obsidian.
- **Web tab id === its native `browserTabs.ts` id.** No temp-id bookkeeping: the
  main process is the source of truth for web tabs; the store mirrors them via
  events (see §3). This also means `target="_blank"` popups (which main opens via
  `setWindowOpenHandler` → `createTab`, emitting a `created` event the renderer
  never asked for) get a strip entry automatically.
- **Native web-tab state** (`url`/`loading`/`canGoBack`/`canGoForward`) is NOT
  duplicated onto `WorkspaceTab`. Keep the existing `BrowserTabState` shape in a
  separate `Record<nativeId, BrowserTabState>` map inside the strip component,
  synced from `browserAPI.onEvent` exactly as `BrowserPanel` does today (that
  subscribe block is copied verbatim). `WorkspaceTab.title` is the only field the
  strip needs from that state, mirrored into the store on `updated`.

### Store shape (apps/web/src/store.ts)

Remove:
```ts
browserUrl: string | null;
openBrowser: (url: string) => void;   // reused name, new body (see below)
closeBrowser: () => void;             // DELETE
```

Add:
```ts
tabs: WorkspaceTab[];        // initial: [{ id: "graph", kind: "graph", title: "Graph" }]
activeTabId: string;         // initial: "graph"

activateTab: (id: string) => void;
openNewTab: () => void;                  // pushes a { kind:"newtab" } tab, activates it
openBrowser: (url: string) => void;      // KEEP NAME — now: browserAPI.createTab(url); "created" event adds+activates the strip tab (see §3)
closeTab: (id: string) => void;          // no-op if id === "graph"; picks strip neighbor as next active
cycleTab: (dir: 1 | -1) => void;         // Ctrl+Tab
setTabTitle: (id: string, title: string) => void;  // called on "updated"
```

`activateTab` is the single choke point that drives the native layer:
```
if next tab is web:   browserAPI.setActiveTab(nativeId); browserAPI.showActive();
else (graph/newtab):  browserAPI.hideAll();
set({ activeTabId });
```
Keeping this in the store (not the component) means keyboard shortcuts and the
markdown-link interceptor route through one place.

---

## 2. Layout / DOM

`.workbench-main` becomes a **flex column**: strip on top, content area below.

```
.workbench-main  (flex-col)
├── <TabWorkspaceStrip/>        ← NEW: full-width strip, graph tab + web/newtab tabs + "+" + chevron menu
├── <WebToolbar/>               ← NEW: slim address/back-fwd bar, RENDERED ONLY when active tab is web
└── .workbench-content (relative, flex-1)   ← NEW wrapper, the old "graph fills everything" box
    ├── <GraphView3D/>          ← always mounted; .graph-top-bar (Force/Constellation + 2D/3D pills) unchanged, lives inside it
    ├── <WebViewport/>          ← the bounds-sync div; rendered ONLY when active tab is web
    ├── <NewTabPage/>           ← rendered ONLY when active tab is newtab
    └── .floating-dock          ← UNCHANGED: NoteEditor / AIPanel / PluginDrawer float over whatever is behind
```

- The strip pushes the content area down; `.graph-top-bar` stays
  `position:absolute` inside `GraphView3D`, now measured from the top of
  `.workbench-content` (a few px lower on screen — acceptable, no code change).
- **Graph stays mounted under every tab.** When a web tab is active the opaque
  `WebContentsView` paints over the whole content area (graph hidden but running);
  when a newtab is active `<NewTabPage/>` (opaque React panel) covers it. Not
  remounting the graph avoids a costly WebGL teardown/rebuild on every tab switch.
  `// ponytail: graph keeps rendering behind web/newtab tabs; add a rAF pause if profiling shows it matters.`
- **Floating dock is orthogonal to tabs** — the editor/AI/plugin cards overlay
  the graph exactly as today, on any tab. No change to the dock. (Note: a web
  tab's native `WebContentsView` will paint *over* the dock, since native layers
  sit above the DOM. Acceptable — same z-order the old floating browser had
  relative to nothing. If the dock must stay visible over a web tab, that's a
  follow-up; not in scope.)

---

## 3. Web tab rendering & bounds-sync

Confirmed mechanism, unchanged from `BrowserPanel`:

- **Bounds-sync element:** the single `<WebViewport/>` div, class
  `.workspace-viewport`, rendered only while the active tab is web. Its
  `ResizeObserver` + `window.resize` handler reports
  `getBoundingClientRect()` → `browserAPI.setBounds(...)`. Copy this effect
  verbatim from `BrowserPanel` (lines 257–273).
- When active tab is web: `setActiveTab(nativeId)` + `showActive()`. When graph
  or newtab: `hideAll()`. (Both already exist in `browserTabs.ts`.)
- New-tab page is plain React (`<NewTabPage/>`), no native view.

**Event → store sync** (single insertion path, in the strip component's
`onEvent` subscription — copied from `BrowserPanel` lines 200–218):
- `created` → `useStore.getState()`: push `{ id: tab.id, kind:"web", title: tab.title||tab.url }` if absent, then `activateTab(tab.id)`. Also seed the local `webStates` map.
- `updated` → update `webStates` map + `setTabTitle(tab.id, title||url)`.
- `closed` → remove from `webStates`; the store `closeTab` already removed the strip entry (see edge cases for the reconcile).
- `activated` → **ignored for strip state** (store is authoritative on active tab; see §closing-active-tab edge case). Only used to keep `webStates` fresh if needed.

`openBrowser(url)` (store): `window.browserAPI?.createTab(url)` — the `created`
event does the rest. Under the plain-browser dev build (no `browserAPI`),
`App.tsx`'s interceptor already falls back to `window.open`, so `openBrowser` is
never reached there; guard with `if (!window.browserAPI) return;` regardless.

---

## 4. New-tab page actions (`<NewTabPage/>`)

Obsidian's four quick actions, mapped to Astro store calls:

| Label (IT / EN)                     | Action |
|-------------------------------------|--------|
| Crea nuovo file (Ctrl+N)            | `store.createNote()` then `store.openNote(id)` (opens the floating editor). Then close this newtab → activate graph. |
| Vai al file (Ctrl+O)                | Open the command palette. It owns its own state + Ctrl+K shortcut, so dispatch a synthetic event: `window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true}))`. `// ponytail: reuses the palette's existing shortcut instead of lifting its open-state into the store.` Then close this newtab. |
| Apri visualizzatore web             | Turn this newtab into a web tab: `store.closeTab(thisId)` + `store.openBrowser("https://www.google.com")`, then focus the address bar (`<WebToolbar/>` auto-focuses its input on mount when the just-activated tab has an empty/blank url). |
| Chiudi                              | `store.closeTab(thisId)` (falls back to the graph tab). |

Render as a centered column of buttons over `.workbench-content`, reusing the
palette/row visual language. Keyboard hints are labels only unless the shortcuts
in §7 are wired.

---

## 5. Address bar + back/forward (`<WebToolbar/>`)

Slim toolbar under the strip, **rendered only when the active tab is web**.
This is the existing `BrowserView` toolbar JSX (BrowserPanel.tsx lines 121–182)
lifted out almost verbatim — back / forward / reload-or-stop / address input /
open-externally. **Drop the trailing "close browser" (×) button** — closing is
now the tab's own × in the strip. Reuse all `.browser-toolbar` / `.browser-nav-btn`
/ `.browser-address` CSS unchanged.

- Reads active web tab state from the `webStates` map (`canGoBack`, `loading`, `url`).
- `onNavigate` → `browserAPI.navigate(nativeId, normalizeUrl(url))` (keep the
  `normalizeUrl` helper). Back/forward/reload/stop/openExternally → existing
  `browserAPI` calls keyed by the active native id.
- Keep `.browser-progress` bar under the toolbar.

---

## 6. Markdown link clicks

`App.tsx`'s delegated click interceptor is **unchanged** — it still calls
`useStore.getState().openBrowser(href)`. New body of `openBrowser` opens a new
web tab and activates it (via the `created` event). One-word-of-behavior change,
zero change at the call site.

---

## 7. Keyboard

Add to `App.tsx`'s existing `onKeyDown` (already handles Ctrl+G/J/B; Ctrl+K is
the palette's own). No conflicts:

| Shortcut   | Action | Notes |
|------------|--------|-------|
| Ctrl/Cmd+T | `store.openNewTab()` | free |
| Ctrl/Cmd+W | `store.closeTab(activeTabId)` | `preventDefault` (Electron would otherwise close the window); no-op on graph tab |
| Ctrl+Tab / Ctrl+Shift+Tab | `store.cycleTab(+1 / -1)` | free |

- **Esc**: if a web tab is active and the address input is focused → blur it;
  otherwise Esc `activateTab("graph")` (returns to the graph without closing —
  preserves the old "Esc leaves the browser" muscle memory, minus the destroy).
  Not a close. Remove `BrowserPanel`'s old Esc-closes handler.

---

## 8. Deletions

- **`apps/web/src/components/BrowserPanel.tsx`** — DELETE the whole file
  (`BrowserPanel` + `BrowserView`). Salvage into the new components: the
  `onEvent` subscribe block, the bounds-sync effect, `normalizeUrl`, the
  `BrowserAPI`/`BrowserTabState`/`BrowserTabEvent` type decls (move to a shared
  `browserTypes.ts` or inline in the strip component), and the toolbar JSX.
- Its dock slot `<BrowserPanel/>` in `App.tsx` — removed (browser is now a tab,
  not a dock card).
- CSS: `.floating-panel.browser-panel` (index.css ~800), and the
  `.browser-tabstrip` / `.browser-tab*` / `.browser-tab-add` block (~870–923) —
  DELETE (the strip is restyled full-width, see §CSS). **Keep**
  `.browser-toolbar`, `.browser-nav-btn`, `.browser-address`, `.browser-viewport`
  (rename usage to `.workspace-viewport` or add it as an alias), `.browser-progress`.

**`browserTabs.ts` API is sufficient — no additions needed.** It already exposes
createTab/closeTab/setActiveTab/setBounds/navigate/goBack/goForward/reload/stop/
openExternally/hideAll/showActive and emits title via `page-title-updated`
(`updated` events). No favicon today; the strip shows title text only (Obsidian's
tabs are text too). **No IPC/preload deltas.**

---

## 9. CSS plan

New classes (add near the old `.browser-*` block):
- `.workbench-content` — `position:relative; flex:1; min-height:0;` (the old graph box).
- `.tab-strip` — `display:flex; align-items:center; height:~36px; gap:2px; padding:0 .4rem; border-bottom:1px solid var(--color-border); background:color-mix(in srgb,var(--color-surface) 92%,transparent);` full width, no `position:absolute`.
- `.workspace-tab` / `.workspace-tab.active` / `.workspace-tab-title` / `.workspace-tab-close` — port from the deleted `.browser-tab*` rules (same look, full-strip context). Active tab gets a subtle bottom accent.
- `.tab-strip-add` (the "+") and `.tab-strip-menu` (chevron dropdown) — port from `.browser-tab-add`.
- `.workspace-viewport` — same rules as `.browser-viewport` (`flex:1; position:relative; background:#fff`); it fills `.workbench-content` absolutely (`position:absolute; inset:0`) since it overlays the graph.
- `.newtab-page` — `position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.5rem; background:var(--color-bg);` + button rows.
- `.tab-strip` must reserve room for the window's native title-bar drag region — mark tab buttons `nodrag` like the old toolbar did (`.browser-tabstrip.nodrag`).

---

## 10. Component tree (new files, apps/web/src/components/)

- `TabWorkspaceStrip.tsx` — owns the `browserAPI.onEvent` subscription + local
  `webStates` map; renders `.tab-strip` (maps `store.tabs`), the "+" button
  (`openNewTab`), and the chevron dropdown menu (list of open tabs with active
  checked, "Close all" → closeTab every non-graph, "Bookmark"/"Stack" can be
  stubs/omitted — `// ponytail: skip stack+bookmark until asked; not in the recorded core flow`).
- `WebToolbar.tsx` — the lifted toolbar; reads active `webStates` entry.
- `NewTabPage.tsx` — the four quick-action buttons (§4).
- `WebViewport.tsx` (or inline in the strip) — the bounds-sync div + effect.

`App.tsx` renders `TabWorkspaceStrip` + conditional `WebToolbar` above
`.workbench-content`, and inside it: `GraphView3D`, conditional `WebViewport`,
conditional `NewTabPage`, and the unchanged `.floating-dock`.

---

## 11. Edge cases

- **Window/panel resize while a web tab is active** — handled by the copied
  `ResizeObserver` + `resize` listener on `.workspace-viewport`; sidebar
  collapse (Ctrl+B) resizes it too, and the observer catches it.
- **Closing the active tab** — `store.closeTab` picks the strip neighbor
  (previous tab, or graph if none) as next active, calls `activateTab(next)`
  *first*, then `browserAPI.closeTab(nativeId)` for a web tab. `browserTabs.ts`
  itself auto-activates its last native tab and emits an `activated` event on
  close — **the store ignores `activated`** (§3), so its own choice wins;
  after the `closed` event lands, re-assert `setActiveTab` for the store's active
  web tab (or `hideAll()` if the store landed on graph/newtab) to reconcile
  main's native active pointer. `// ponytail: one reconcile line covers the race; simpler than teaching main about the graph tab.`
- **Closing a non-active tab** — remove strip entry + `browserAPI.closeTab`; no
  activation change.
- **Graph tab close attempt** (× hidden, but Ctrl+W / menu) — `closeTab` early-returns on `id==="graph"`.
- **Last web tab closed** — falls back to graph; `hideAll()` leaves no native
  view attached; graph is already mounted and visible.
- **Esc** — §7 (blur address, else return to graph; never closes).
- **Plain-browser dev build** (no `browserAPI`) — `openBrowser` guards and
  returns; App.tsx's interceptor already uses `window.open`. The strip renders
  only the graph tab (+ any newtab pages); web tabs never appear. No crash.

---

## Summary

Move the browser's tab strip out of the floating card and up to the top of
`.workbench-main` as a full-width Obsidian-style strip whose permanent first tab
is the 3D graph. Web pages open as sibling tabs backed by the **unchanged**
`browserTabs.ts` `WebContentsView` infra; new-tab pages are plain React. A slim
address/back-forward toolbar (lifted from `BrowserView`) shows only for web
tabs; a single bounds-sync `.workspace-viewport` div positions the native layer.
`openBrowser(url)` and the markdown-link interceptor keep their names/call sites;
their behavior becomes "open a web tab". Delete `BrowserPanel.tsx` and the
`.browser-panel`/`.browser-tab*` CSS; keep toolbar/viewport/progress CSS. No new
IPC, no preload changes, no new dependencies.

**Open decisions made:**
1. Graph tab is permanent and un-closable (the one divergence from Obsidian) — losing it loses the app's surface.
2. Web-tab id === native `browserTabs.ts` id; main process is the source of truth, store mirrors via events (handles `target=_blank` popups for free).
3. Store's active tab is authoritative — the `activated` event is ignored to avoid main's graph-unaware auto-activate fighting the strip.
4. Graph stays mounted (not remounted) behind web/newtab tabs; native web view paints over it, and over the floating dock (accepted).
5. Esc returns to the graph tab instead of closing; Ctrl+W never closes the graph.
6. Chevron menu ships with tab-list + "close all" only; stack/bookmark deferred (not in the recorded core flow).
