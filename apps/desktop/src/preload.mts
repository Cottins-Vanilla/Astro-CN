import { contextBridge, ipcRenderer } from "electron";
import type { CanvasDoc, Note, VaultMeta } from "@solen/core";

/** `{ path, name }` for a vault folder — `name` is just the folder's
 * basename. Returned by the Phase 20b multi-vault methods below. */
interface VaultInfo {
  path: string;
  name: string;
}

/**
 * Exposes a narrow `window.vaultAPI` to the renderer — this is the ONLY
 * bridge between the sandboxed web app and the filesystem; every method just
 * IPC-invokes a matching `ipcMain.handle` in main.ts, which delegates to the
 * one `FilesystemVaultAdapter` for the current vault folder. Mirrors
 * `VaultAdapter` from @solen/core (see apps/web/src/adapters/ipcVault.ts,
 * which implements `VaultAdapter` on the renderer side by calling these)
 * plus desktop-only extras: `pickVaultFolder`/`getCurrentVaultPath` (Phase
 * 20a) and the Phase 20b multi-vault switcher methods
 * (`listRecentVaults`/`createVault`/`openVault`/`switchVault`/
 * `getCurrentVault`) that VaultSwitcher.tsx calls directly on
 * `window.vaultAPI` rather than through `IpcVaultAdapter`.
 *
 * Only type-only imports are pulled from @solen/core here (erased at compile
 * time) — the preload never bundles or runs @solen/core's actual JS, keeping
 * it a thin, auditable IPC shim.
 */
contextBridge.exposeInMainWorld("vaultAPI", {
  getMeta: (): Promise<VaultMeta | undefined> => ipcRenderer.invoke("vault:getMeta"),
  writeMeta: (meta: VaultMeta): Promise<void> => ipcRenderer.invoke("vault:writeMeta", meta),

  listNotes: () => ipcRenderer.invoke("vault:listNotes"),
  readNote: (id: string): Promise<Note> => ipcRenderer.invoke("vault:readNote", id),
  writeNote: (note: Note): Promise<void> => ipcRenderer.invoke("vault:writeNote", note),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke("vault:deleteNote", id),
  rescan: () => ipcRenderer.invoke("vault:rescan"),
  moveNote: (id: string, folder: string | undefined): Promise<void> =>
    ipcRenderer.invoke("vault:moveNote", id, folder),
  /** Fires whenever the main process's live filesystem watcher (see
   * apps/desktop/src/vaultWatcher.ts) sees the vault folder change — an Explorer rename/edit/
   * delete, a file dropped in, or (harmlessly, since rescanVault() is a no-op diff) the app's own
   * writes. store.ts calls `vault.rescan()` in response. */
  onExternalChange: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("vault:externalChange", listener);
    return () => ipcRenderer.off("vault:externalChange", listener);
  },

  listCanvases: () => ipcRenderer.invoke("vault:listCanvases"),
  readCanvas: (id: string): Promise<CanvasDoc> => ipcRenderer.invoke("vault:readCanvas", id),
  writeCanvas: (doc: CanvasDoc): Promise<void> => ipcRenderer.invoke("vault:writeCanvas", doc),
  deleteCanvas: (id: string): Promise<void> => ipcRenderer.invoke("vault:deleteCanvas", id),

  pickVaultFolder: (): Promise<string | null> => ipcRenderer.invoke("vault:pickVaultFolder"),
  getCurrentVaultPath: (): Promise<string | null> => ipcRenderer.invoke("vault:getCurrentVaultPath"),

  // --- Phase 20b: multi-vault switcher (VaultSwitcher.tsx) ------------------
  listRecentVaults: (): Promise<VaultInfo[]> => ipcRenderer.invoke("vault:listRecentVaults"),
  createVault: (): Promise<VaultInfo | null> => ipcRenderer.invoke("vault:createVault"),
  openVault: (): Promise<VaultInfo | null> => ipcRenderer.invoke("vault:openVault"),
  switchVault: (vaultPath: string): Promise<void> => ipcRenderer.invoke("vault:switchVault", vaultPath),
  getCurrentVault: (): Promise<VaultInfo | null> => ipcRenderer.invoke("vault:getCurrentVault"),
});

/**
 * Separate from `vaultAPI` since it has nothing to do with the vault — this is what lets the app
 * draw its own minimize/maximize/close buttons (WindowControls.tsx) instead of Electron's native
 * overlay, which could not dim with a modal backdrop or scale with the interface zoom (see
 * main.ts's createWindow).
 *
 * `platform` rides along because macOS keeps its native traffic lights under
 * `titleBarStyle: "hidden"` — drawing a second set there would be one set too many.
 */
contextBridge.exposeInMainWorld("windowAPI", {
  platform: process.platform,
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke("window:toggleMaximize"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean) => cb(maximized);
    ipcRenderer.on("window:maximizedChanged", listener);
    return () => ipcRenderer.removeListener("window:maximizedChanged", listener);
  },
});

interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}
type BrowserTabEvent =
  | { type: "created"; tab: BrowserTabState }
  | { type: "closed"; id: string }
  | { type: "updated"; tab: BrowserTabState }
  | { type: "activated"; id: string | null };
interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * BrowserPanel.tsx's bridge to the main process's `BrowserTabManager`
 * (apps/desktop/src/browserTabs.ts) — the in-app browser's tabs are real
 * `WebContentsView`s living in the main window's own contentView, not DOM
 * elements, so every action (navigate, resize, close) crosses this IPC
 * boundary instead of touching a ref directly the way the old `<webview>`
 * tag did. `onEvent` fans out `created`/`updated`/`closed`/`activated`
 * pushes the manager sends whenever a tab's title/URL/loading state changes.
 */
contextBridge.exposeInMainWorld("browserAPI", {
  createTab: (url: string): Promise<string> => ipcRenderer.invoke("browser:createTab", url),
  closeTab: (id: string): Promise<void> => ipcRenderer.invoke("browser:closeTab", id),
  setActiveTab: (id: string | null): Promise<void> => ipcRenderer.invoke("browser:setActiveTab", id),
  setBounds: (rect: BrowserRect): Promise<void> => ipcRenderer.invoke("browser:setBounds", rect),
  navigate: (id: string, url: string): Promise<void> => ipcRenderer.invoke("browser:navigate", id, url),
  goBack: (id: string): Promise<void> => ipcRenderer.invoke("browser:goBack", id),
  goForward: (id: string): Promise<void> => ipcRenderer.invoke("browser:goForward", id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke("browser:reload", id),
  stop: (id: string): Promise<void> => ipcRenderer.invoke("browser:stop", id),
  openExternally: (id: string): Promise<void> => ipcRenderer.invoke("browser:openExternally", id),
  listTabs: (): Promise<BrowserTabState[]> => ipcRenderer.invoke("browser:listTabs"),
  hideAll: (): Promise<void> => ipcRenderer.invoke("browser:hideAll"),
  showActive: (): Promise<void> => ipcRenderer.invoke("browser:showActive"),
  onEvent: (cb: (event: BrowserTabEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: BrowserTabEvent) => cb(event);
    ipcRenderer.on("browser:event", listener);
    return () => ipcRenderer.off("browser:event", listener);
  },
});

type TerminalEvent =
  | { type: "data"; id: string; chunk: string }
  | { type: "exit"; id: string; code: number | null };

/**
 * TerminalPanel.tsx's bridge to the main process's `TerminalManager`
 * (apps/desktop/src/terminal.ts) — one spawned shell at a time, keyed by id the same way
 * `browserAPI` keys tabs. `create` only takes the initial pty size: the renderer never names the
 * executable or its cwd, main.ts decides both (see terminal.ts's security note). `onEvent` fans out
 * `data`/`exit` pushes the same way `browserAPI.onEvent` does.
 */
contextBridge.exposeInMainWorld("terminalAPI", {
  create: (cols: number, rows: number): Promise<string> => ipcRenderer.invoke("terminal:create", cols, rows),
  write: (id: string, data: string): Promise<void> => ipcRenderer.invoke("terminal:write", id, data),
  resize: (id: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke("terminal:resize", id, cols, rows),
  kill: (id: string): Promise<void> => ipcRenderer.invoke("terminal:kill", id),
  onEvent: (cb: (event: TerminalEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: TerminalEvent) => cb(event);
    ipcRenderer.on("terminal:event", listener);
    return () => ipcRenderer.off("terminal:event", listener);
  },
});

interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

/** Settings → Account's bridge to googleAuth.ts. The renderer supplies the OAuth client id it has
 * stored in vault settings and gets a profile back — access tokens stay in the main process. */
contextBridge.exposeInMainWorld("googleAuthAPI", {
  signIn: (clientId: string): Promise<GoogleProfile> => ipcRenderer.invoke("google:signIn", clientId),
  signOut: (): Promise<void> => ipcRenderer.invoke("google:signOut"),
  getProfile: (): Promise<GoogleProfile | null> => ipcRenderer.invoke("google:getProfile"),
});

interface ConstellationPatternData {
  id: string;
  name: string;
  stars: ReadonlyArray<{ x: number; y: number }>;
  parent: ReadonlyArray<number>;
}

/**
 * See docs/ARCH-CONSTELLATIONS.md. `getCached` returns the last downloaded set (or `null` before
 * the first successful download), `download` fetches a fresh one — both resolve to the same
 * `ConstellationPatternData[]` shape `apps/web/src/graph3d/layouts/patterns.ts`'s bundled
 * `PATTERNS` uses, so the renderer can use either interchangeably.
 */
contextBridge.exposeInMainWorld("constellationsAPI", {
  getCached: (): Promise<ConstellationPatternData[] | null> => ipcRenderer.invoke("constellations:getCached"),
  download: (): Promise<ConstellationPatternData[]> => ipcRenderer.invoke("constellations:download"),
});

type McpClientState = "not-installed" | "not-connected" | "connected";
interface McpClientStatus {
  id: string;
  name: string;
  state: McpClientState;
  stale?: boolean;
  error?: string;
}
interface McpTestResult {
  ok: boolean;
  vaultPath?: string;
  noteCount?: number;
  error?: string;
}
interface McpUnverifiedClient {
  id: string;
  name: string;
  pathHint: string | null;
  note: string;
  snippetFormat: "json" | "none";
}
interface McpListResult {
  entryPath: string | null;
  clients: McpClientStatus[];
  unverified: McpUnverifiedClient[];
  vaultRootPath: string | null;
}

/**
 * Settings → Connections' bridge to the main process's mcpConnections.ts — hooks locally installed
 * AI agents up to Astro's own MCP server (packages/mcp-server) so they can read/write the open
 * vault. `connect`/`disconnect` take only a client id from the known table; main.ts rejects
 * anything else, and this bridge never lets the renderer name a path or command itself.
 */
contextBridge.exposeInMainWorld("mcpAPI", {
  listClients: (): Promise<McpListResult> => ipcRenderer.invoke("mcp:listClients"),
  connect: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("mcp:connect", id),
  disconnect: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("mcp:disconnect", id),
  test: (): Promise<McpTestResult> => ipcRenderer.invoke("mcp:test"),
  revealConfig: (id: string): Promise<void> => ipcRenderer.invoke("mcp:revealConfig", id),
});

