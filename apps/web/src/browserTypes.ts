/**
 * Shared types for the `window.browserAPI` bridge (see apps/desktop/src/browserTabs.ts and its
 * preload exposure) — one native `WebContentsView` per web tab, driven from the renderer via this
 * API. Split out of the old BrowserPanel.tsx (now TabWorkspaceStrip.tsx / WebToolbar.tsx — see
 * docs/ARCH-TAB-WORKSPACE.md) since both components, plus store.ts's `activateTab`/`closeTab`/
 * `openBrowser`, need them.
 */

export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type BrowserTabEvent =
  | { type: "created"; tab: BrowserTabState }
  | { type: "closed"; id: string }
  | { type: "updated"; tab: BrowserTabState }
  | { type: "activated"; id: string | null };

export interface BrowserAPI {
  createTab(url: string): Promise<string>;
  closeTab(id: string): Promise<void>;
  setActiveTab(id: string | null): Promise<void>;
  setBounds(rect: { x: number; y: number; width: number; height: number }): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  goBack(id: string): Promise<void>;
  goForward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  openExternally(id: string): Promise<void>;
  hideAll(): Promise<void>;
  showActive(): Promise<void>;
  onEvent(cb: (event: BrowserTabEvent) => void): () => void;
}

export type TerminalEvent =
  | { type: "data"; id: string; chunk: string }
  | { type: "exit"; id: string; code: number | null };

/** Bridge for TerminalPanel.tsx (see apps/desktop/src/terminal.ts and its preload exposure) — one
 * spawned shell at a time, keyed by id like `BrowserAPI` keys tabs. `create` only takes the initial
 * pty size; main.ts alone decides the shell executable and its cwd. */
export interface TerminalAPI {
  create(cols: number, rows: number): Promise<string>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  onEvent(cb: (event: TerminalEvent) => void): () => void;
}

/** Google account profile returned by `googleAuthAPI.signIn` — see apps/desktop/src/googleAuth.ts. */
export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

/** Settings → Account's bridge. Desktop-only: the browser build has no system browser to hand the
 * OAuth consent screen to, nor a loopback server to catch the redirect. */
export interface GoogleAuthAPI {
  signIn(clientId: string): Promise<GoogleProfile>;
  signOut(): Promise<void>;
  getProfile(): Promise<GoogleProfile | null>;
}

/** Settings → Connections' client state, one row per verified client (see
 * apps/desktop/src/mcpConnections.ts). `error` is set when the existing config file failed to
 * parse — Connect/Disconnect stay disabled for that row regardless of `state`. */
export type McpClientState = "configured" | "not-configured";

export interface McpClientStatus {
  id: string;
  name: string;
  state: McpClientState;
  /** The client itself looks installed. Advisory — a miss is shown as a hint, never a blocker. */
  detected: boolean;
  /** The exact config file Astro writes into. */
  configPath: string;
  /** Configured, but the entry in the file is not what Astro would write now (old path, leftover
   * --vault argument) — see mcpConnections.ts's `getClientStatus`. */
  stale?: boolean;
  error?: string;
}

/** Result of `mcpAPI.test()` — Settings → Connections' "Test connection" probe (see
 * apps/desktop/src/mcpProbe.ts). Astro can't observe a client reading its config, so this
 * reproduces the chain the config points at instead: spawn the server, handshake, list notes. */
export interface McpTestResult {
  ok: boolean;
  vaultPath?: string;
  noteCount?: number;
  error?: string;
}

/** A client whose config path and/or schema couldn't be confirmed — shown with a copyable snippet
 * instead of a Connect button. `snippetFormat: "none"` (ChatGPT Desktop) means there's no local
 * config to paste anything into at all. */
export interface McpUnverifiedClient {
  id: string;
  name: string;
  pathHint: string | null;
  note: string;
  snippetFormat: "json" | "none";
}

export interface McpListResult {
  /** packages/mcp-server's built entry point, or `null` if it hasn't been built yet — every Connect
   * button is disabled in that case (see mcpConnections.ts). */
  entryPath: string | null;
  clients: McpClientStatus[];
  unverified: McpUnverifiedClient[];
}

/** Desktop-only bridge to apps/desktop/src/mcpConnections.ts. `connect`/`disconnect` take only a
 * known client id — never a path or command, see the preload's security note. */
export interface McpAPI {
  listClients(): Promise<McpListResult>;
  connect(id: string): Promise<{ ok: boolean; error?: string }>;
  disconnect(id: string): Promise<{ ok: boolean; error?: string }>;
  test(): Promise<McpTestResult>;
  revealConfig(id: string): Promise<void>;
}

declare global {
  interface Window {
    browserAPI?: BrowserAPI;
    terminalAPI?: TerminalAPI;
    googleAuthAPI?: GoogleAuthAPI;
    mcpAPI?: McpAPI;
  }
}

export const isDesktop = typeof navigator !== "undefined" && /\bElectron\//i.test(navigator.userAgent);
