import { readSidebarOrder, moveSidebarFolder, sidebarLevelKeys, parentPath, renameSidebarFolder, deleteSidebarFolder, type SidebarOrder } from "./sidebarOrdering";
import { create } from "zustand";
import { folderPath, folderTree, allFolderPaths, isInsideFolder, renameFolderPlan, moveFolderPlan, applyFolderMoves } from "./noteFolders";
import {
  ghostTitleFromId,
  IndexedDbVault,
  newCanvasId,
  newEdgeId,
  newNodeId,
  newNoteId,
  parseInlineTags,
  type CanvasDoc,
  type CanvasNode,
  type Note,
  type NoteMeta,
  type VaultAdapter,
  type VaultMeta,
  type VaultSettings,
} from "@solen/core";
import { NOTE_NODE_HEIGHT, NOTE_NODE_WIDTH } from "./vaultDefaults";
import { seedDemo } from "./seed";
import { vaultEvents } from "./events";
import { DEFAULT_AI_CONFIG, type AIProviderConfig } from "./ai/types";
import { downloadVaultArchive, readVaultArchiveFile } from "./vaultArchive";
import { removeWikiLinkOccurrences, wikiLinksAfterRename } from "./noteLinks";
import { IpcVaultAdapter } from "./adapters/ipcVault";
import { DEFAULT_SEARCH_ENGINE } from "./searchEngines";
import "./browserTypes";

/** Editor body font size (px) the Editor settings section defaults to — matches the `--text-base`
 * the editor rendered at before the setting existed. */
const DEFAULT_EDITOR_FONT_SIZE = 14;

export type ThemeName = NonNullable<VaultSettings["theme"]>;
export type SettingsTab = "editor" | "appearance" | "hotkeys" | "web" | "account" | "sync" | "connections" | "ai" | "plugins" | "about";
/** A tab in the top workspace strip (see docs/ARCH-TAB-WORKSPACE.md) — the graph, an open web
 * page, or a blank new-tab page. `id` for a web tab IS its native `browserTabs.ts` id (the main
 * process is the source of truth for web tabs; this store just mirrors them via events); `"graph"`
 * for the one permanent tab; `"nt-<n>"` for a new-tab page. */
export type TabKind = "graph" | "web" | "newtab";
export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  /** web: synced from browserAPI "updated" events; graph: "Graph"; newtab: "New tab". */
  title: string;
}
/** Which presentation the 3D graph is currently showing — see docs/CONSTELLATION.md. */
export type GraphMode = "force" | "constellation";
/** "3d" is the full orbit-camera graph; "2d" locks the camera face-on and flattens the force
 * layout to z≈0 — see docs/WORKSPACE-3D.md's "2D / 3D". */
export type GraphDimension = "2d" | "3d";
/** Shape of `settings.ui` — the vault-settings bucket for small view-state toggles (sidebar,
 * graph dimension/animation) that aren't worth their own top-level `settings` key. Read with a
 * cast (like `settings.graph`, `settings.ai`, …) since `VaultSettings` is deliberately an open
 * `[key: string]: unknown` bag — see packages/core/src/types.ts. */
interface UiSettings {
  sidebarOrder?: SidebarOrder;
  noteFolders?: string[];
  sidebarOpen?: boolean;
  graphDimension?: GraphDimension;
  graphAnimating?: boolean;
  /** Accent color override (hex), applied as `--color-accent` — see docs/ARCH-APPEARANCE.md §2.
   * Absent/undefined means "use the active theme's own accent". */
  accentColor?: string;
  /** Interface zoom factor (0.8–1.3, default 1), applied via CSS `zoom` on `#root` — see
   * docs/ARCH-APPEARANCE.md §2.3. */
  uiZoom?: number;
  /** Editor gutter line numbers (CodeMirror's `lineNumbers()` extension) — see NoteEditor.tsx. */
  lineNumbers?: boolean;
  /** Caps the editor's text column width for readability — a CSS class toggle, see
   * `.editor-readable-width` in index.css. */
  readableLineLength?: boolean;
  /** Editor body font size in px (14 default) — applied as `--editor-font-size`. */
  editorFontSize?: number;
  /** Which search engine the web viewer's address bar falls back to for non-URL input — an id
   * from searchEngines.ts's `SEARCH_ENGINES`. */
  searchEngine?: string;
  /** URL template (with a `%s` placeholder) used when `searchEngine` is "custom". */
  customSearchUrl?: string;
  /** The user's own Google Cloud OAuth client id (Desktop app type) used by Settings → Account's
   * sign-in — see apps/desktop/src/googleAuth.ts. Not a secret (PKCE, no client secret). */
  googleClientId?: string;
}

/**
 * Whether the graph's idle camera motion actually runs. Two inputs, and keeping them apart is the
 * whole point: `preference` is what the user checked and is the only half that gets persisted;
 * 2D merely *suspends* it, because a face-on locked camera has nothing to rotate. Collapsing the
 * two — persisting the suspended value — is what made one trip through 2D kill auto-rotate for
 * good, restarts included.
 */
export function animationActive(preference: boolean, dimension: GraphDimension): boolean {
  return preference && dimension === "3d";
}

/** The user's own Animation choice, mirroring the persisted `settings.ui.graphAnimating`. Module
 * scope, not store state: the store's `graphAnimating` is the *effective* value (see above), and
 * the panel checkbox reads that one. */
let animationPreference = true;

/** Live d3-force-3d parameters the Graph settings panel's Forces sliders drive — see
 * `physics.ts`'s `setForces`. Field names match the panel's slider labels, not the underlying
 * d3-force force names, since "Repel" reads better than "charge". */
export interface GraphForces {
  center: number;
  repel: number;
  linkForce: number;
  linkDistance: number;
}
/** Renderer-facing display knobs the panel's Display sliders/toggles drive. `arrows` is the only
 * boolean; everything else is a multiplier or density factor applied on top of the renderer's own
 * hard-coded baseline — see `renderer.ts`. Animation is deliberately absent here: it reuses the
 * existing `graphAnimating` flag (Phase 17) instead of duplicating it. */
export interface GraphDisplaySettings {
  nodeSize: number;
  linkThickness: number;
  textFade: number;
  arrows: boolean;
}
/** Filters section state. `orphans`/`existingOnly` read as "show" toggles (true = visible, the
 * default) rather than "hide" toggles, matching their on-by-default checkbox in the panel. */
export interface GraphFilterSettings {
  search: string;
  orphans: boolean;
  existingOnly: boolean;
}
export interface GraphSettings {
  forces: GraphForces;
  display: GraphDisplaySettings;
  filters: GraphFilterSettings;
}

/** Defaults reproduce the graph's pre-Phase-18 behavior exactly — same values `GraphPhysics`'s
 * constructor and `SceneRenderer`'s hard-coded baseline used before the settings panel existed —
 * so nothing visibly changes until a slider or toggle actually moves. */
const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  forces: { center: 1, repel: -150, linkForce: 0.5, linkDistance: 70 },
  display: { nodeSize: 1, linkThickness: 1, textFade: 1, arrows: false },
  filters: { search: "", orphans: true, existingOnly: false },
};

// Electron's preload script (apps/desktop/src/preload.ts) sets
// `window.vaultAPI` before the renderer's own scripts run; its presence is
// how the app tells "running inside the desktop shell" apart from "running
// in a browser tab". Desktop gets a real filesystem vault (writes land on
// disk via IPC — see apps/desktop/src/filesystemVault.ts); the browser keeps
// using IndexedDB. Nothing else in this file (auto-save debounce, note/graph
// edits, `currentMeta`) needs to know which one it's talking to.
const vault: VaultAdapter =
  typeof window !== "undefined" && window.vaultAPI ? new IpcVaultAdapter() : new IndexedDbVault();
/** Note edits (title/body) are debounced this long before hitting IndexedDB. Exported so
 * GraphView3D's external-change refresh can wait *longer* than this — otherwise it would read a
 * note's still-stale on-disk title/body right out from under an in-flight save. */
export const SAVE_DEBOUNCE_MS = 500;
// Per-note debounce timers for body/title edits, keyed by note id — separate
// from any other save timer so editing a note never delays another pending
// write (or vice versa).
const noteSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Debounces `settings.graph` writes the same way `noteSaveTimers` debounces note body/title
// writes — a Forces/Display slider fires its `onChange` on every drag tick, and none of that
// belongs in IndexedDB until the user stops moving it.
let graphSettingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
// Guards against React 18 StrictMode double-invoking init() and seeding the
// demo vault twice in a race.
let initPromise: Promise<void> | null = null;
// The last vault metadata read/written, kept outside React state so
// `setTheme`/`setGraphForces` etc. can patch its `settings` object without
// re-fetching it.
let currentMeta: VaultMeta | null = null;
// Counter for newtab-page ids ("nt-<n>") — see openNewTab. Module-level so ids stay unique across
// the tab's lifetime without threading a counter through store state.
let newTabCounter = 0;

function toNoteMeta(note: Note): NoteMeta {
  const { id, title, tags, createdAt, updatedAt } = note;
  return { id, title, tags, createdAt, updatedAt };
}

function touch(doc: CanvasDoc): CanvasDoc {
  return { ...doc, updatedAt: new Date().toISOString() };
}

function isNoteNode(n: CanvasNode): n is Extract<CanvasNode, { type: "note" }> {
  return n.type === "note";
}

/** The single canvas doc that backs the 3D graph's structural (drag-created) edges — see
 * docs/WORKSPACE-3D.md. Reuses the first canvas the vault has (the seeded one, in practice);
 * creates one lazily if somehow none exists. The `.scanvas` format persists this even though
 * there's no 2D canvas UI to look at it in — it's just the edge store now. */
async function getOrCreateGraphCanvas(): Promise<CanvasDoc> {
  const metas = await vault.listCanvases();
  if (metas.length > 0) return vault.readCanvas(metas[0].id);
  const now = new Date().toISOString();
  const doc: CanvasDoc = {
    format: "scanvas",
    version: 1,
    id: newCanvasId(),
    name: "星图",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  };
  await vault.writeCanvas(doc);
  return doc;
}

/** Finds (or appends) the note-type canvas node representing `noteId` in `doc`. Returns the
 * possibly-updated doc alongside that node's canvas-local id (edges reference node ids, not
 * note ids directly — see docs/DATA-FORMAT.md). */
function ensureNoteNode(doc: CanvasDoc, noteId: string): { doc: CanvasDoc; nodeId: string } {
  const existing = doc.nodes.filter(isNoteNode).find((n) => n.noteId === noteId);
  if (existing) return { doc, nodeId: existing.id };
  const node: CanvasNode = {
    id: newNodeId(),
    type: "note",
    x: 0,
    y: 0,
    width: NOTE_NODE_WIDTH,
    height: NOTE_NODE_HEIGHT,
    noteId,
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, nodeId: node.id };
}

interface AppState {
  ready: boolean;
  notes: Record<string, Note>;
  /** Metadata for every note in the vault, for the sidebar's notes list. */
  noteList: NoteMeta[];
  collapsedNoteFolders: string[];
  setCollapsedNoteFolders: (paths: string[]) => void;
  sidebarOrder: SidebarOrder;
  setSidebarOrder: (order: SidebarOrder) => void;
  noteFolders: string[];
  setNoteFolders: (folders: string[]) => void;
  /** Id of the note currently open in the editor panel, if any. */
  openNoteId: string | null;
  /** Active theme — a vault setting, persisted via `vault.json`'s open `settings` object. */
  theme: ThemeName;
  /** Whether the notes-explorer sidebar is expanded — a vault setting under `settings.ui.sidebarOpen`. */
  sidebarOpen: boolean;
  /** Force layout vs. star-chart Constellation Mode — same graph, different presentation. */
  graphMode: GraphMode;
  /** 2D (flat, face-on, rotate locked) vs. 3D (full orbit) — a vault setting under
   * `settings.ui.graphDimension`. See docs/WORKSPACE-3D.md's "2D / 3D". */
  graphDimension: GraphDimension;
  /** Whether the graph's idle camera motion (3D Force auto-rotate, 3D Constellation sway) runs —
   * a vault setting under `settings.ui.graphAnimating`. */
  graphAnimating: boolean;
  /** Accent color override (hex) or undefined for the theme's own accent — a vault setting under
   * `settings.ui.accentColor`. See docs/ARCH-APPEARANCE.md §2. */
  accentColor: string | undefined;
  /** Interface zoom factor (0.8–1.3) — a vault setting under `settings.ui.uiZoom`. See
   * docs/ARCH-APPEARANCE.md §2.3. */
  uiZoom: number;
  /** Editor gutter line numbers — a vault setting under `settings.ui.lineNumbers`. See
   * NoteEditor.tsx. */
  lineNumbers: boolean;
  /** Caps the editor's text column width for readability — a vault setting under
   * `settings.ui.readableLineLength`. */
  readableLineLength: boolean;
  /** Editor body font size in px — a vault setting under `settings.ui.editorFontSize`. */
  editorFontSize: number;
  /** Search engine id for the web viewer's address bar — a vault setting under
   * `settings.ui.searchEngine`. See searchEngines.ts. */
  searchEngine: string;
  /** Custom search URL template used when `searchEngine` is "custom" — a vault setting under
   * `settings.ui.customSearchUrl`. */
  customSearchUrl: string;
  /** Google OAuth client id for Settings → Account — a vault setting under
   * `settings.ui.googleClientId`. */
  googleClientId: string;
  /** Graph settings panel state (Filters/Display/Forces) — a vault setting under `settings.graph`.
   * See `GraphSettings`. */
  graphSettings: GraphSettings;
  /** Whether the floating Graph settings panel is open — ephemeral, never persisted. */
  graphPanelOpen: boolean;
  /** A note the graph just created and wants the editor's title input focused for. */
  pendingTitleFocusId: string | null;
  /** Ephemeral node/edge counts for the status bar, fed by GraphView3D whenever it (re)builds
   * topology — not persisted, never read on init. */
  graphStats: { nodeCount: number; edgeCount: number };
  /** Whether the AI chat panel is showing. */
  aiPanelOpen: boolean;
  /** Whether the integrated terminal panel is showing (desktop-only — see TerminalPanel.tsx and
   * the `hasTerminalApi` guard in Ribbon.tsx). Ephemeral, never persisted, same as `aiPanelOpen`. */
  terminalOpen: boolean;
  /** The top workspace strip's open tabs — always starts with the permanent graph tab at index 0.
   * See docs/ARCH-TAB-WORKSPACE.md. */
  tabs: WorkspaceTab[];
  /** id of the tab currently showing in `.workbench-content`. */
  activeTabId: string;
  /** AI provider settings — a vault setting under `settings.ai`. */
  aiConfig: AIProviderConfig;
  /** Per-plugin enabled state — a vault setting under `settings.plugins`. Absent id defaults to enabled. */
  pluginEnabled: Record<string, boolean>;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  /** Whether the desktop-only vault switcher (VaultSwitcher.tsx) is open. Ephemeral, never
   * persisted, and only ever toggled from the ribbon's vault button — which itself only renders
   * when `window.vaultAPI` exists (Electron), so this stays permanently false in the browser. */
  vaultSwitcherOpen: boolean;

  init: () => Promise<void>;
  setTheme: (theme: ThemeName) => void;
  toggleSidebar: () => void;
  setGraphMode: (mode: GraphMode) => void;
  toggleGraphMode: () => void;
  setGraphDimension: (dimension: GraphDimension) => void;
  toggleGraphAnimating: () => void;
  /** Sets the accent color override; pass `undefined` to clear it and fall back to the theme's own
   * accent. Persists to `settings.ui.accentColor`. */
  setAccentColor: (color: string | undefined) => void;
  /** Sets the interface zoom factor. Persists to `settings.ui.uiZoom`. */
  setUiZoom: (zoom: number) => void;
  /** Toggles the editor gutter line numbers. Persists to `settings.ui.lineNumbers`. */
  setLineNumbers: (on: boolean) => void;
  /** Toggles the editor's readable line-length cap. Persists to `settings.ui.readableLineLength`. */
  setReadableLineLength: (on: boolean) => void;
  /** Sets the editor body font size in px. Persists to `settings.ui.editorFontSize`. */
  setEditorFontSize: (px: number) => void;
  /** Sets the address bar's search engine (an id from `SEARCH_ENGINES`, or "custom" paired with
   * `setCustomSearchUrl`). Persists to `settings.ui.searchEngine`. */
  setSearchEngine: (id: string) => void;
  /** Sets the custom search URL template (`%s` placeholder). Persists to
   * `settings.ui.customSearchUrl`. */
  setCustomSearchUrl: (template: string) => void;
  /** Sets the Google OAuth client id. Persists to `settings.ui.googleClientId`. */
  setGoogleClientId: (clientId: string) => void;
  setGraphStats: (stats: { nodeCount: number; edgeCount: number }) => void;
  /** Merge-patch the Forces sliders' values; persists (debounced) under `settings.graph.forces`. */
  setGraphForces: (patch: Partial<GraphForces>) => void;
  /** Merge-patch the Display section's sliders/toggles; persists (debounced) under
   * `settings.graph.display`. */
  setGraphDisplay: (patch: Partial<GraphDisplaySettings>) => void;
  /** Merge-patch the Filters section's search/orphans/existingOnly; persists (debounced) under
   * `settings.graph.filters`. */
  setGraphFilters: (patch: Partial<GraphFilterSettings>) => void;
  toggleGraphPanel: () => void;
  toggleAIPanel: () => void;
  toggleTerminal: () => void;
  /** The single choke point that drives the native browser layer: switches `activeTabId`, and
   * tells `browserTabs.ts` to show the new tab's native view (web) or hide every native view
   * (graph/newtab). Keeping this in the store (not a component) means keyboard shortcuts and the
   * markdown-link interceptor route through one place. */
  activateTab: (id: string) => void;
  /** Opens a blank new-tab page as a fresh tab and activates it. */
  openNewTab: () => void;
  /** Opens `url` in a new web tab (or navigates the current one open — see App.tsx's markdown-link
   * interceptor). Reused name/call-site from the old floating browser panel; the body now opens a
   * tab instead of a floating card. Creation is async on the main-process side — the strip's
   * `created` event is what actually pushes the tab and activates it (see TabWorkspaceStrip.tsx). */
  openBrowser: (url: string) => void;
  /** Removes a tab from the strip. No-op on the graph tab (permanent, not closable — see
   * docs/ARCH-TAB-WORKSPACE.md §1). Picks the strip neighbor (previous tab, or graph if none) as
   * the next active tab. */
  closeTab: (id: string) => void;
  /** Ctrl+Tab / Ctrl+Shift+Tab: activates the next/previous tab, wrapping around. */
  cycleTab: (dir: 1 | -1) => void;
  /** Mirrors a web tab's native title (from browserAPI's "updated" event) onto its strip entry. */
  setTabTitle: (id: string, title: string) => void;
  setAIConfig: (patch: Partial<AIProviderConfig>) => void;
  setPluginEnabled: (id: string, enabled: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: SettingsTab) => void;
  openVaultSwitcher: () => void;
  closeVaultSwitcher: () => void;

  createNote: (title?: string) => Promise<Note>;
  openNote: (id: string) => Promise<void>;
  closeEditor: () => void;
  flushNoteSaves: () => Promise<void>;
  updateNoteTitle: (id: string, title: string) => void;
  updateNoteBody: (id: string, body: string) => void;
  renameNote: (id: string, title: string) => Promise<void>;
  renameNoteFolder: (path: string, name: string) => Promise<string>;
  moveNoteFolder: (path: string, parent: string) => Promise<string>;
  deleteNoteFolder: (path: string, deleteContents?: boolean) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /** Moves a note into `folder` (or the root, if undefined) — the storage side of dragging a
   * star into a folder in the graph. */
  moveNote: (id: string, folder: string | undefined) => Promise<void>;
  /** Re-reads the vault for changes made outside the app (an Explorer rename/edit while this
   * window wasn't focused) and folds them in — see docs/ARCH-VAULT-STORAGE.md problem 2. Called
   * on window focus (see `init`). */
  rescanVault: () => Promise<void>;
  /** Resolve a `[[Title]]` case-insensitively, creating a ghost note if none exists, then open it. */
  openOrCreateNoteByTitle: (title: string) => Promise<void>;

  /** Flag a note so the editor focuses its title input the next time it opens. */
  requestTitleFocus: (id: string) => void;
  clearTitleFocusRequest: () => void;

  /** Create a structural link (a canvas edge) between two notes — the 3D graph's
   * shift-drag gesture. No note body is ever touched by this. */
  linkNotes: (fromId: string, toId: string) => Promise<void>;
  /** Fully disconnects two notes — the graph's Unlink action. Removes every wiki-link (in either
   * note's body) AND every structural (canvas) edge connecting them, across every canvas, so no
   * dimmer duplicate connection can linger after a single Unlink click. */
  unlinkNotePair: (idA: string, idB: string) => Promise<void>;

  /** Serialize the whole vault to the DATA-FORMAT.md archive layout and download it as a ZIP. */
  exportVault: () => Promise<void>;
  /** Parse a picked archive and merge it into the vault: notes/canvases with matching ids are
   * overwritten, everything else is left alone. Caller is responsible for warning the user first. */
  importVaultFile: (file: File) => Promise<{ noteCount: number; canvasCount: number }>;
}

export const useStore = create<AppState>((set, get) => {
  const noteTasks = new Map<string, Promise<void>>();
  const deletingNotes = new Set<string>();
  const pendingNoteRenames = new Map<string, Note>();
  // Renames also update referencing notes, so serialize note I/O across ids.
  let noteIoTask: Promise<void> = Promise.resolve();
  function queueNoteTask(id: string, action: () => Promise<void>): Promise<void> {
    const task = noteIoTask.catch(() => {}).then(action);
    noteIoTask = task;
    noteTasks.set(id, task);
    const cleanup = () => { if (noteTasks.get(id) === task) noteTasks.delete(id); };
    void task.then(cleanup, cleanup);
    return task;
  }
  function scheduleNoteSave(id: string) {
    const existing = noteSaveTimers.get(id);
    if (existing) clearTimeout(existing);
    noteSaveTimers.set(
      id,
      setTimeout(() => {
        noteSaveTimers.delete(id);
        void queueNoteTask(id, async () => {
          const note = get().notes[id];
          if (note && !deletingNotes.has(id)) await saveNoteWithLinks(id);
        }).catch(error => console.error("笔记保存失败", error));
      }, SAVE_DEBOUNCE_MS),
    );
  }

  async function saveNoteWithLinks(id: string): Promise<void> {
    const original = pendingNoteRenames.get(id);
    if (!original) {
      const note = get().notes[id];
      if (note) await vault.writeNote(note);
      return;
    }
    // Load uncached backlinks, then overlay live edits so a rename never loses unsaved code.
    const metas = await vault.listNotes();
    const disk = await Promise.all(metas.map(meta => vault.readNote(meta.id)));
    const liveNote = get().notes[id];
    if (!liveNote || deletingNotes.has(id)) return;
    const latest = { ...liveNote, title: liveNote.title.trim() || "未命名" };
    const before = disk.map(note => {
      const live = get().notes[note.id] ?? note;
      const prior = pendingNoteRenames.get(note.id);
      return prior ? { ...live, title: prior.title } : live;
    });
    const rewrite = wikiLinksAfterRename(before, original, latest.title);
    const changes = disk.map(note => {
      const live = note.id === id ? latest : get().notes[note.id] ?? note;
      const body = rewrite(live);
      return { previous: note, next: body === live.body ? live : {
        ...live, body, tags: parseInlineTags(body), updatedAt: new Date().toISOString(),
      } };
    }).filter(({ previous, next }) => next.id === id || next.body !== previous.body || next.title !== previous.title);
    // A just-created note can still be absent from a stale listing.
    if (!changes.some(change => change.next.id === id)) changes.push({ previous: original, next: latest });
    const notes = { ...get().notes };
    for (const { next } of changes) notes[next.id] = next;
    const byId = new Map(changes.map(({ next }) => [next.id, next]));
    set({ notes, noteList: get().noteList.map(meta => {
      const next = byId.get(meta.id); return next ? { ...meta, ...toNoteMeta(next) } : meta;
    }) });
    const written: Note[] = [];
    try {
      for (const { previous, next } of changes) {
        written.push(previous);
        await vault.writeNote(next);
      }
    } catch (error) {
      // Keep the last consistent disk version if any part of the multi-note save fails.
      for (const previous of written.reverse()) {
        try { await vault.writeNote(previous); } catch (rollbackError) { console.error("重命名恢复失败", rollbackError); }
      }
      const afterRename = before.map(note => note.id === id ? { ...note, title: latest.title } : note);
      const undoLinks = wikiLinksAfterRename(afterRename, latest, original.title);
      const restored = { ...get().notes };
      for (const { next } of changes) {
        const current = restored[next.id];
        if (!current) continue;
        const body = undoLinks(current);
        restored[next.id] = { ...current, body, tags: parseInlineTags(body) };
      }
      if (restored[id]?.title === latest.title) {
        restored[id] = { ...restored[id], title: original.title };
        pendingNoteRenames.delete(id);
      }
      set({ notes: restored, noteList: get().noteList.map(meta => {
        const current = restored[meta.id]; return current ? { ...meta, ...toNoteMeta(current) } : meta;
      }) });
      throw error;
    }
    const current = get().notes[id];
    if (current && current.title !== latest.title) pendingNoteRenames.set(id, latest);
    else pendingNoteRenames.delete(id);
    for (const { next } of changes) vaultEvents.emit("note:updated", { id: next.id });
  }

  /** Shared cleanup for a note that's gone — whether deleted in-app (`deleteNote`) or found
   * missing on an external rescan (`rescanVault`): sweeps every canvas for note-nodes/edges
   * referencing it, and strips lingering `[[deletedTitle]]` wikilink text from every other note's
   * body so the derived graph never resurrects it as a ghost. See `deleteNote`'s original comment
   * for why this matters. */
  async function sweepAfterNoteRemoved(id: string, deletedTitle: string | undefined): Promise<void> {
    pendingNoteRenames.delete(id);
    const canvasMetas = await vault.listCanvases();
    for (const meta of canvasMetas) {
      const doc = await vault.readCanvas(meta.id);
      const removedNodeIds = new Set(doc.nodes.filter(isNoteNode).filter((n) => n.noteId === id).map((n) => n.id));
      if (removedNodeIds.size === 0) continue;
      const updated = touch({
        ...doc,
        nodes: doc.nodes.filter((n) => !removedNodeIds.has(n.id)),
        edges: doc.edges.filter((e) => !removedNodeIds.has(e.from) && !removedNodeIds.has(e.to)),
      });
      await vault.writeCanvas(updated);
      vaultEvents.emit("canvas:changed", { id: updated.id });
    }

    if (deletedTitle) {
      for (const meta of get().noteList) {
        if (meta.id === id) continue;
        const cached = get().notes[meta.id];
        // `get().noteList` is the PRE-rescan list, so when several notes were deleted outside the
        // app at once it still names the other casualties — whose files are already gone. Reading
        // one throws, which used to reject the whole `rescanVault()` before it could commit the
        // fresh list, freezing the sidebar's count until a restart. A note that no longer exists
        // needs no wiki-link stripping: it is about to be swept by this same pass.
        let note = cached;
        if (!note) {
          try {
            note = await vault.readNote(meta.id);
          } catch {
            continue;
          }
        }
        const strippedBody = removeWikiLinkOccurrences(note.body, deletedTitle);
        if (strippedBody === note.body) continue;
        const updatedAt = new Date().toISOString();
        const updated = { ...note, body: strippedBody, updatedAt };
        await vault.writeNote(updated);
        if (cached) set({ notes: { ...get().notes, [meta.id]: updated } });
        vaultEvents.emit("note:updated", { id: meta.id });
      }
    }

    const notes = { ...get().notes };
    delete notes[id];
    set({
      notes,
      noteList: get().noteList.filter((n) => n.id !== id),
      openNoteId: get().openNoteId === id ? null : get().openNoteId,
    });
    vaultEvents.emit("note:deleted", { id });
  }

  /** Writes the whole `graphSettings` object to `settings.graph`, replacing whatever was there —
   * unlike `persistUi`'s per-key merge, there's nothing else under `settings.graph` to preserve
   * (an older vault's `graph.pins` — see docs/WORKSPACE-3D.md — is simply overwritten by this,
   * same as it was already never read). Debounced via `scheduleGraphSettingsPersist` so a slider
   * drag doesn't hit IndexedDB on every tick. */
  function persistGraph(graphSettings: GraphSettings) {
    const meta = currentMeta;
    if (!meta) return;
    currentMeta = { ...meta, settings: { ...meta.settings, graph: graphSettings } };
    void vault.writeMeta(currentMeta);
  }

  function scheduleGraphSettingsPersist() {
    if (graphSettingsSaveTimer) clearTimeout(graphSettingsSaveTimer);
    graphSettingsSaveTimer = setTimeout(() => {
      graphSettingsSaveTimer = null;
      persistGraph(get().graphSettings);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Merges `patch` into the persisted `settings.ui` bucket (sidebar, graph dimension/animation —
   * see `UiSettings`) and writes it. Merges rather than replaces so, e.g., toggling the sidebar
   * never clobbers an already-persisted `graphDimension`, and vice versa. */
  let uiWriteTask = Promise.resolve();
  function persistUi(patch: Partial<UiSettings>) {
    const meta = currentMeta;
    if (!meta) return;
    const ui: UiSettings = { ...(meta.settings.ui as UiSettings | undefined), ...patch };
    currentMeta = { ...meta, settings: { ...meta.settings, ui } };
    uiWriteTask = uiWriteTask.catch(() => {}).then(async () => {
      if (currentMeta) await vault.writeMeta(currentMeta);
    }).catch(error => console.error("界面状态保存失败", error));
  }

  return {
    ready: false,
    notes: {},
    noteList: [],
    collapsedNoteFolders: [],
    setCollapsedNoteFolders(paths) {
      const collapsedNoteFolders = [...new Set(paths.map(folderPath))];
      set({ collapsedNoteFolders });
    },
    sidebarOrder: {},
    setSidebarOrder(order) {
      const sidebarOrder = readSidebarOrder(order);
      set({ sidebarOrder });
      persistUi({ sidebarOrder });
    },
    noteFolders: [],
    setNoteFolders(folders) {
      const noteFolders = [...new Set(folders.map(folderPath))];
      set({ noteFolders });
      persistUi({ noteFolders });
    },
    openNoteId: null,
    theme: "dark",
    sidebarOpen: true,
    graphMode: "force",
    graphDimension: "3d",
    graphAnimating: true,
    accentColor: undefined,
    uiZoom: 1,
    lineNumbers: false,
    readableLineLength: true,
    editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
    searchEngine: DEFAULT_SEARCH_ENGINE,
    customSearchUrl: "",
    googleClientId: "",
    graphSettings: DEFAULT_GRAPH_SETTINGS,
    graphPanelOpen: false,
    pendingTitleFocusId: null,
    graphStats: { nodeCount: 0, edgeCount: 0 },
    aiPanelOpen: false,
    terminalOpen: false,
    tabs: [{ id: "graph", kind: "graph", title: "星图" }],
    activeTabId: "graph",
    aiConfig: DEFAULT_AI_CONFIG,
    pluginEnabled: {},
    settingsOpen: false,
    settingsTab: "appearance",
    vaultSwitcherOpen: false,

    async init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        let meta = await vault.getMeta();
        const canvasMetas = await vault.listCanvases();

        if (!meta || canvasMetas.length === 0) {
          const { notes, canvas } = seedDemo();
          meta = {
            format: "solen-vault",
            version: 1,
            name: "我的知识库",
            createdAt: new Date().toISOString(),
            settings: { theme: "dark" },
          } satisfies VaultMeta;
          await vault.writeMeta(meta);
          for (const note of notes) await vault.writeNote(note);
          await vault.writeCanvas(canvas);
        }

        currentMeta = meta;
        const noteList = await vault.listNotes();
        const aiConfig = { ...DEFAULT_AI_CONFIG, ...(meta.settings.ai as Partial<AIProviderConfig> | undefined) };
        const pluginEnabled = (meta.settings.plugins as Record<string, boolean> | undefined) ?? {};
        // Partial, not `GraphSettings | undefined`: an older vault's `settings.graph` may still be
        // the retired `{ pins: {...} }` shape (see docs/WORKSPACE-3D.md), which has none of these
        // keys — every sub-object merge below falls back to its default in that case.
        const savedGraph = meta.settings.graph as Partial<GraphSettings> | undefined;
        const graphSettings: GraphSettings = {
          forces: { ...DEFAULT_GRAPH_SETTINGS.forces, ...savedGraph?.forces },
          display: { ...DEFAULT_GRAPH_SETTINGS.display, ...savedGraph?.display },
          filters: { ...DEFAULT_GRAPH_SETTINGS.filters, ...savedGraph?.filters },
        };
        const ui = (meta.settings.ui as UiSettings | undefined) ?? {};
        // `settings.ui.graphAnimating` is the user's preference, never the 2D-suspended value —
        // so a vault last closed in 2D still comes back with auto-rotate armed for the moment it
        // returns to 3D. See `animationActive`.
        animationPreference = ui.graphAnimating ?? true;
        const graphDimension = ui.graphDimension ?? "3d";
        set({
          noteList,
          ready: true,
          theme: meta.settings.theme ?? "dark",
          aiConfig,
          pluginEnabled,
          graphSettings,
          sidebarOpen: ui.sidebarOpen ?? true,
          sidebarOrder: readSidebarOrder(ui.sidebarOrder),
          // Start every session with all existing folders (including implicit parents) collapsed.
          collapsedNoteFolders: allFolderPaths(folderTree([
            ...(Array.isArray(ui.noteFolders) ? ui.noteFolders.filter((p): p is string => typeof p === "string") : []),
            ...noteList.map(n => n.folder ?? ""),
          ])),
          noteFolders: Array.isArray(ui.noteFolders) ? ui.noteFolders.filter((f): f is string => typeof f === "string") : [],
          graphDimension: graphDimension,
          graphAnimating: animationActive(animationPreference, graphDimension),
          accentColor: ui.accentColor,
          uiZoom: ui.uiZoom ?? 1,
          lineNumbers: ui.lineNumbers ?? false,
          readableLineLength: ui.readableLineLength ?? true,
          editorFontSize: ui.editorFontSize ?? DEFAULT_EDITOR_FONT_SIZE,
          searchEngine: ui.searchEngine ?? DEFAULT_SEARCH_ENGINE,
          customSearchUrl: ui.customSearchUrl ?? "",
          googleClientId: ui.googleClientId ?? "",
        });

        // Under Electron, the main process's live filesystem watcher (apps/desktop/src/
        // vaultWatcher.ts) pushes an event the instant the vault folder changes on disk — an
        // Explorer rename/edit/delete, a file dropped in — so changes propagate immediately
        // rather than waiting for the window to regain focus. The focus listener stays as a
        // fallback (harmless — rescanVault() is a no-op diff when nothing changed) for the
        // browser/IndexedDB build, which has no filesystem to watch.
        // `void` on its own would discard a rejection silently, and a rescan that dies half-way
        // leaves the UI showing a vault state that no longer exists — the one failure mode here
        // that must not be invisible.
        const rescan = () => void get().rescanVault().catch((err) => console.error("rescanVault failed", err));
        window.vaultAPI?.onExternalChange(rescan);
        if (typeof window !== "undefined") {
          window.addEventListener("focus", rescan);
        }
      })();
      return initPromise;
    },

    setTheme(theme) {
      set({ theme });
      const meta = currentMeta;
      if (!meta) return;
      currentMeta = { ...meta, settings: { ...meta.settings, theme } };
      void vault.writeMeta(currentMeta);
      vaultEvents.emit("theme:changed", { theme });
    },

    toggleSidebar() {
      const sidebarOpen = !get().sidebarOpen;
      set({ sidebarOpen });
      persistUi({ sidebarOpen });
    },

    setGraphStats(stats) {
      set({ graphStats: stats });
    },

    setGraphMode(mode) {
      set({ graphMode: mode });
    },

    toggleGraphMode() {
      set({ graphMode: get().graphMode === "force" ? "constellation" : "force" });
    },

    setGraphDimension(dimension) {
      set({ graphDimension: dimension, graphAnimating: animationActive(animationPreference, dimension) });
      persistUi({ graphDimension: dimension });
      // Deliberately NOT persisting graphAnimating here — 2D only *suspends* the camera motion, it
      // is not a choice the user made. Writing the suspended `false` to the vault is what made a
      // single trip through 2D disable auto-rotate permanently, across restarts included.
    },

    setGraphForces(patch) {
      const graphSettings = { ...get().graphSettings, forces: { ...get().graphSettings.forces, ...patch } };
      set({ graphSettings });
      scheduleGraphSettingsPersist();
    },

    setGraphDisplay(patch) {
      const graphSettings = { ...get().graphSettings, display: { ...get().graphSettings.display, ...patch } };
      set({ graphSettings });
      scheduleGraphSettingsPersist();
    },

    setGraphFilters(patch) {
      const graphSettings = { ...get().graphSettings, filters: { ...get().graphSettings.filters, ...patch } };
      set({ graphSettings });
      scheduleGraphSettingsPersist();
    },

    toggleGraphPanel() {
      set({ graphPanelOpen: !get().graphPanelOpen });
    },

    toggleGraphAnimating() {
      // This is the ONLY place the user's own preference changes, so it is the only place that
      // persists it — see setGraphDimension for why 2D must not.
      animationPreference = !get().graphAnimating;
      persistUi({ graphAnimating: animationPreference });
      set({ graphAnimating: animationActive(animationPreference, get().graphDimension) });
      // Auto-rotate/sway only exist in 3D — enabling Animation while flat in 2D would otherwise do
      // nothing visible, so switch to 3D too. One choke point so the panel toggle, StatusBar, and
      // Command Palette all pick this up. Disabling never touches dimension.
      if (animationPreference && get().graphDimension === "2d") get().setGraphDimension("3d");
    },

    toggleAIPanel() {
      set({ aiPanelOpen: !get().aiPanelOpen });
    },

    toggleTerminal() {
      set({ terminalOpen: !get().terminalOpen });
    },

    setAccentColor(color) {
      set({ accentColor: color });
      persistUi({ accentColor: color });
    },

    setUiZoom(zoom) {
      set({ uiZoom: zoom });
      persistUi({ uiZoom: zoom });
    },

    setLineNumbers(on) {
      set({ lineNumbers: on });
      persistUi({ lineNumbers: on });
    },

    setReadableLineLength(on) {
      set({ readableLineLength: on });
      persistUi({ readableLineLength: on });
    },

    setEditorFontSize(px) {
      set({ editorFontSize: px });
      persistUi({ editorFontSize: px });
    },

    setSearchEngine(id) {
      set({ searchEngine: id });
      persistUi({ searchEngine: id });
    },

    setCustomSearchUrl(template) {
      set({ customSearchUrl: template });
      persistUi({ customSearchUrl: template });
    },

    setGoogleClientId(clientId) {
      set({ googleClientId: clientId });
      persistUi({ googleClientId: clientId });
    },

    activateTab(id) {
      const tab = get().tabs.find((t) => t.id === id);
      if (tab?.kind === "web") {
        void window.browserAPI?.setActiveTab(id);
        void window.browserAPI?.showActive();
      } else {
        void window.browserAPI?.hideAll();
      }
      set({ activeTabId: id });
    },

    openNewTab() {
      const id = `nt-${++newTabCounter}`;
      set({ tabs: [...get().tabs, { id, kind: "newtab", title: "新建标签页" }] });
      get().activateTab(id);
    },

    openBrowser(url) {
      if (!window.browserAPI) return;
      void window.browserAPI.createTab(url);
    },

    closeTab(id) {
      if (id === "graph") return;
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const closingTab = tabs[idx];
      const nextTabs = tabs.filter((t) => t.id !== id);
      set({ tabs: nextTabs });
      if (activeTabId === id) {
        const neighborId = nextTabs[Math.max(0, idx - 1)]?.id ?? "graph";
        get().activateTab(neighborId);
      }
      if (closingTab.kind === "web") void window.browserAPI?.closeTab(id);
    },

    cycleTab(dir) {
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return;
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      get().activateTab(next.id);
    },

    setTabTitle(id, title) {
      set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, title } : t)) });
    },

    setAIConfig(patch) {
      const aiConfig = { ...get().aiConfig, ...patch };
      set({ aiConfig });
      const meta = currentMeta;
      if (!meta) return;
      currentMeta = { ...meta, settings: { ...meta.settings, ai: aiConfig } };
      void vault.writeMeta(currentMeta);
    },

    setPluginEnabled(id, enabled) {
      const pluginEnabled = { ...get().pluginEnabled, [id]: enabled };
      set({ pluginEnabled });
      const meta = currentMeta;
      if (!meta) return;
      currentMeta = { ...meta, settings: { ...meta.settings, plugins: pluginEnabled } };
      void vault.writeMeta(currentMeta);
    },

    openSettings(tab) {
      set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab });
    },

    closeSettings() {
      set({ settingsOpen: false });
    },

    setSettingsTab(tab) {
      set({ settingsTab: tab });
    },

    openVaultSwitcher() {
      set({ vaultSwitcherOpen: true });
    },

    closeVaultSwitcher() {
      set({ vaultSwitcherOpen: false });
    },

    async createNote(title = "未命名") {
      const now = new Date().toISOString();
      const note: Note = {
        id: newNoteId(),
        title,
        tags: [],
        createdAt: now,
        updatedAt: now,
        body: "",
      };
      await vault.writeNote(note);
      set({
        notes: { ...get().notes, [note.id]: note },
        noteList: [toNoteMeta(note), ...get().noteList],
      });
      vaultEvents.emit("note:created", { id: note.id });
      return note;
    },

    async openNote(id) {
      if (!get().notes[id]) {
        const note = await vault.readNote(id);
        set({ notes: { ...get().notes, [id]: note } });
      }
      set({ openNoteId: id });
    },

    closeEditor() {
      set({ openNoteId: null });
    },

    async flushNoteSaves() {
      for (const [id, timer] of noteSaveTimers) {
        clearTimeout(timer);
        noteSaveTimers.delete(id);
        void queueNoteTask(id, async () => {
          if (!deletingNotes.has(id)) await saveNoteWithLinks(id);
        }).catch(error => console.error("笔记保存失败", error));
      }
      await noteIoTask;
    },

    updateNoteTitle(id, title) {
      if (deletingNotes.has(id)) return;
      const note = get().notes[id];
      if (!note) return;
      if (note.title === title) return;
      if (!pendingNoteRenames.has(id)) pendingNoteRenames.set(id, note);
      const updatedAt = new Date().toISOString();
      set({
        notes: { ...get().notes, [id]: { ...note, title, updatedAt } },
        noteList: get().noteList.map((n) => (n.id === id ? { ...n, title, updatedAt } : n)),
      });
      scheduleNoteSave(id);
      vaultEvents.emit("note:updated", { id });
    },

    updateNoteBody(id, body) {
      if (deletingNotes.has(id)) return;
      const note = get().notes[id];
      if (!note) return;
      const tags = parseInlineTags(body);
      const updatedAt = new Date().toISOString();
      set({
        notes: { ...get().notes, [id]: { ...note, body, tags, updatedAt } },
        noteList: get().noteList.map((n) => (n.id === id ? { ...n, tags, updatedAt } : n)),
      });
      scheduleNoteSave(id);
      vaultEvents.emit("note:updated", { id });
    },

async renameNote(id, title) {
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error("笔记名称不能为空。");
      const timer = noteSaveTimers.get(id);
      if (timer) clearTimeout(timer);
      noteSaveTimers.delete(id);
      await queueNoteTask(id, async () => {
        if (deletingNotes.has(id)) throw new Error("这篇笔记正在删除。");
        const note = get().notes[id] ?? await vault.readNote(id);
        const updatedAt = new Date().toISOString();
        if (!pendingNoteRenames.has(id)) pendingNoteRenames.set(id, note);
        const latest = get().notes[id] ?? note;
        set({
          notes: { ...get().notes, [id]: { ...latest, title: cleanTitle, updatedAt } },
          noteList: get().noteList.map(n => n.id === id ? { ...n, title: cleanTitle, updatedAt } : n),
        });
        await saveNoteWithLinks(id);
      });
    },

    async renameNoteFolder(path, name) {
      const state = get();
      const paths = allFolderPaths(folderTree([...state.noteFolders, ...state.noteList.map(n => n.folder ?? "")]));
      if (!paths.includes(path)) throw new Error("这个文件夹已不存在。");
      const plan = renameFolderPlan(path, name, paths, state.noteList);
      await applyFolderMoves(plan.moves, (id, target) => get().moveNote(id, target));
      get().setNoteFolders(plan.folders);
      get().setSidebarOrder(renameSidebarFolder(get().sidebarOrder, path, plan.destination));
      get().setCollapsedNoteFolders(get().collapsedNoteFolders.map(p => isInsideFolder(p, path) ? plan.destination + p.slice(path.length) : p));
      return plan.destination;
    },

    async moveNoteFolder(path, parent) {
      const state = get();
      const paths = allFolderPaths(folderTree([...state.noteFolders, ...state.noteList.map(n => n.folder ?? "")]));
      const plan = moveFolderPlan(path, parent, paths, state.noteList);
      if (plan.destination === path) return path;
      const sourceKeys = sidebarLevelKeys(paths, state.noteList, parentPath(path), state.sidebarOrder);
      const targetKeys = sidebarLevelKeys(paths, state.noteList, parentPath(plan.destination), state.sidebarOrder);
      await applyFolderMoves(plan.moves, (id, target) => get().moveNote(id, target));
      get().setNoteFolders(plan.folders);
      get().setSidebarOrder(moveSidebarFolder(get().sidebarOrder, path, plan.destination, sourceKeys, targetKeys));
      get().setCollapsedNoteFolders(get().collapsedNoteFolders.map(p => isInsideFolder(p, path) ? plan.destination + p.slice(path.length) : p));
      return plan.destination;
    },

    async deleteNoteFolder(path, deleteContents = false) {
      const state = get();
      const paths = allFolderPaths(folderTree([...state.noteFolders, ...state.noteList.map(n => n.folder ?? "")]));
      if (!paths.includes(path)) throw new Error("这个文件夹已不存在。");
      const affected = state.noteList.filter(n => isInsideFolder(n.folder, path));
      if (deleteContents) {
        for (const note of affected) await get().deleteNote(note.id);
      } else {
        await applyFolderMoves(affected.map(n => ({ id: n.id, from: n.folder, to: undefined })),
          (id, target) => get().moveNote(id, target));
      }
      get().setNoteFolders(paths.filter(p => !isInsideFolder(p, path)));
      get().setSidebarOrder(deleteSidebarFolder(get().sidebarOrder, path));
      get().setCollapsedNoteFolders(get().collapsedNoteFolders.filter(p => !isInsideFolder(p, path)));
    },

    async deleteNote(id) {
      if (deletingNotes.has(id)) return;
      deletingNotes.add(id);
      const timer = noteSaveTimers.get(id);
      if (timer) clearTimeout(timer);
      noteSaveTimers.delete(id);
      try {
        await queueNoteTask(id, async () => {
          const deletedTitle = get().noteList.find(n => n.id === id)?.title;
          await vault.deleteNote(id);
          await sweepAfterNoteRemoved(id, deletedTitle);
        });
      } finally { deletingNotes.delete(id); }
    },


    async moveNote(id, folder) {
      const target = folder ? folderPath(folder) : undefined;
      const timer = noteSaveTimers.get(id);
      if (timer) clearTimeout(timer);
      noteSaveTimers.delete(id);
      await queueNoteTask(id, async () => {
        const cached = get().notes[id];
        if (cached) await saveNoteWithLinks(id);
        await vault.moveNote(id, target);
        const latest = get().notes[id];
        set({
          noteList: get().noteList.map((n) => n.id === id ? { ...n, folder: target } : n),
          ...(latest ? { notes: { ...get().notes, [id]: { ...latest, folder: target } } } : {}),
        });
        vaultEvents.emit("note:updated", { id });
      });
    },

    async rescanVault() {
      await noteIoTask.catch(() => {});
      const fresh = await vault.rescan();
      const freshById = new Map(fresh.map((n) => [n.id, n]));
      const prevList = get().noteList;

      for (const prev of prevList) {
        if (!freshById.has(prev.id)) await sweepAfterNoteRemoved(prev.id, prev.title);
      }

      // A note with a pending debounced save (scheduleNoteSave, up to SAVE_DEBOUNCE_MS out) has an
      // in-memory edit disk hasn't seen yet — `fresh` just read the pre-flush, stale file. Adopting
      // it here would both flicker the UI back to stale content AND, once the pending save fires
      // moments later, overwrite the user's real edit on disk with that same staleness. The
      // in-memory version stays authoritative for these ids until their own save lands.
      const pendingIds = new Set([...noteSaveTimers.keys(), ...noteTasks.keys(), ...pendingNoteRenames.keys()]);

      const prevById = new Map(get().noteList.map((n) => [n.id, n]));
      const noteList = fresh.map((meta) => (pendingIds.has(meta.id) ? (prevById.get(meta.id) ?? meta) : meta));
      set({ noteList });
      for (const meta of fresh) {
        if (pendingIds.has(meta.id)) continue;
        const prev = prevById.get(meta.id);
        if (prev && prev.title === meta.title && prev.folder === meta.folder && prev.updatedAt === meta.updatedAt) {
          continue; // unchanged
        }
        if (get().notes[meta.id]) {
          const note = await vault.readNote(meta.id);
          set({ notes: { ...get().notes, [meta.id]: note } });
        }
        vaultEvents.emit(prev ? "note:updated" : "note:created", { id: meta.id });
      }
    },

    async openOrCreateNoteByTitle(title) {
      const targetLower = title.toLowerCase();
      // `openNote` already loads a note's body from the vault on demand, so
      // resolving to an id (from the metadata list, which covers every note
      // in the vault) is all that's needed here.
      const existingId = get().noteList.find((n) => n.title.toLowerCase() === targetLower)?.id;
      const id = existingId ?? (await get().createNote(title)).id;
      await get().openNote(id);
    },

    requestTitleFocus(id) {
      set({ pendingTitleFocusId: id });
    },

    clearTitleFocusRequest() {
      set({ pendingTitleFocusId: null });
    },

    async linkNotes(fromId, toId) {
      if (fromId === toId) return;
      let doc = await getOrCreateGraphCanvas();
      const from = ensureNoteNode(doc, fromId);
      doc = from.doc;
      const to = ensureNoteNode(doc, toId);
      doc = to.doc;

      const alreadyLinked = doc.edges.some(
        (e) =>
          (e.from === from.nodeId && e.to === to.nodeId) || (e.from === to.nodeId && e.to === from.nodeId),
      );
      if (!alreadyLinked) {
        doc = { ...doc, edges: [...doc.edges, { id: newEdgeId(), from: from.nodeId, to: to.nodeId }] };
      }

      doc = touch(doc);
      await vault.writeCanvas(doc);
      vaultEvents.emit("canvas:changed", { id: doc.id });
    },

    async unlinkNotePair(idA, idB) {
      // Either endpoint can be a ghost (an unresolved `[[wiki-link]]` target with no note behind
      // it — see buildLinkIndex): it has no body to strip and `readNote` would throw on its id,
      // but the real note across from it still holds the link that conjured it, and the ghost's
      // own id carries the title needed to strip it.
      const titleOf = (id: string) => get().noteList.find((n) => n.id === id)?.title ?? ghostTitleFromId(id);
      const titleA = titleOf(idA);
      const titleB = titleOf(idB);

      // A pair of notes can be connected by a wiki-link in EITHER note's body, a structural
      // (canvas) edge, or both at once (the two link mechanisms are independent — see
      // docs/WORKSPACE-3D.md) — Unlink must sever every one of them, not just whichever the
      // clicked edge happened to represent, or a "less bright" duplicate edge lingers.
      for (const [fromId, targetTitle] of [
        [idA, titleB],
        [idB, titleA],
      ] as const) {
        if (!targetTitle || ghostTitleFromId(fromId) !== null) continue;
        const cached = get().notes[fromId];
        const note = cached ?? (await vault.readNote(fromId));
        const strippedBody = removeWikiLinkOccurrences(note.body, targetTitle);
        if (strippedBody === note.body) continue;
        const updated = { ...note, body: strippedBody, updatedAt: new Date().toISOString() };
        await vault.writeNote(updated);
        set({ notes: { ...get().notes, [fromId]: updated } });
        vaultEvents.emit("note:updated", { id: fromId });
      }

      const canvasMetas = await vault.listCanvases();
      for (const meta of canvasMetas) {
        const doc = await vault.readCanvas(meta.id);
        const nodeIdsA = new Set(doc.nodes.filter(isNoteNode).filter((n) => n.noteId === idA).map((n) => n.id));
        const nodeIdsB = new Set(doc.nodes.filter(isNoteNode).filter((n) => n.noteId === idB).map((n) => n.id));
        if (nodeIdsA.size === 0 || nodeIdsB.size === 0) continue;
        const removedIds = new Set(
          doc.edges
            .filter((e) => (nodeIdsA.has(e.from) && nodeIdsB.has(e.to)) || (nodeIdsA.has(e.to) && nodeIdsB.has(e.from)))
            .map((e) => e.id),
        );
        if (removedIds.size === 0) continue;
        const updated = touch({ ...doc, edges: doc.edges.filter((e) => !removedIds.has(e.id)) });
        await vault.writeCanvas(updated);
        vaultEvents.emit("canvas:changed", { id: updated.id });
      }
    },

    async exportVault() {
      const meta = currentMeta ?? {
        format: "solen-vault" as const,
        version: 1 as const,
        name: "我的知识库",
        createdAt: new Date().toISOString(),
        settings: {},
      };
      const noteMetas = await vault.listNotes();
      const notes = await Promise.all(noteMetas.map((n) => vault.readNote(n.id)));
      const canvasMetas = await vault.listCanvases();
      const canvases = await Promise.all(canvasMetas.map((c) => vault.readCanvas(c.id)));
      // meta.name is just the seeded "My Vault" literal (see init()), not the vault folder name —
      // under Electron the real folder name comes from vaultAPI instead. Browser build has no
      // folder, so it falls back to meta.name.
      const nameOverride = window.vaultAPI ? (await window.vaultAPI.getCurrentVault())?.name : undefined;
      downloadVaultArchive({ meta, notes, canvases }, nameOverride);
    },

    async importVaultFile(file) {
      const { notes, canvases } = await readVaultArchiveFile(file);
      for (const note of notes) await vault.writeNote(note);
      for (const canvas of canvases) await vault.writeCanvas(canvas);

      const noteList = await vault.listNotes();
      set({ noteList });

      // Reload anything currently open in case it was among the imported ids.
      const openNoteId = get().openNoteId;
      if (openNoteId && noteList.some((n) => n.id === openNoteId)) {
        const note = await vault.readNote(openNoteId);
        set({ notes: { ...get().notes, [openNoteId]: note } });
      }

      // Nudge the graph to rebuild its topology from the newly-written vault state.
      for (const note of notes) vaultEvents.emit("note:updated", { id: note.id });
      for (const canvas of canvases) vaultEvents.emit("canvas:changed", { id: canvas.id });

      return { noteCount: notes.length, canvasCount: canvases.length };
    },
  };
});

export { vault };
