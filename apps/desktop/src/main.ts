import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type Rectangle } from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasDoc, Note, VaultMeta } from "@solen/core";
import { FilesystemVaultAdapter } from "./filesystemVault.js";
import { type DesktopConfig, promoteRecentVault, readConfig, removeRecentVault, writeConfig } from "./config.js";
import { BrowserTabManager, type BrowserTabEvent } from "./browserTabs.js";
import { TerminalManager, type TerminalEvent } from "./terminal.js";
import { VaultWatcher } from "./vaultWatcher.js";
import { downloadConstellationPatterns, getCachedConstellationPatterns } from "./constellations.js";
import { currentGoogleProfile, googleSignIn, googleSignOut } from "./googleAuth.js";
import { collectDetectionProbes } from "./clientDetect.js";
import {
  connectClient,
  disconnectClient,
  getClientStatus,
  resolveConfigPath,
  UNVERIFIED_CLIENTS,
  VERIFIED_CLIENTS,
  type PathRoots,
} from "./mcpConnections.js";
import { probeMcpServer } from "./mcpProbe.js";

app.commandLine.appendSwitch("lang", "zh-CN");
app.setPath("userData", process.env.ASTRO_ZH_TEST_USER_DATA_DIR || path.join(app.getPath("appData"), "Astro-Chinese"));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A development run gets its own `userData` directory, so testing Astro cannot touch the vault
 * list of the Astro you actually use.
 *
 * Electron derives `userData` from the package name, and electron-builder's `productName` lives in
 * the build config rather than at the root of package.json — so the packaged app and `pnpm dev`
 * both resolved to `<appData>/@solen/desktop` and shared one `desktop-config.json`. The
 * consequence is not hypothetical: recording the demo footage for the README pointed that shared
 * config at a throwaway vault, and the freshly installed release then opened it, listing the
 * developer's real vaults beside it. Nothing leaked (no path is baked into the build) but the two
 * lives were writing over each other.
 *
 * Must run before anything reads `userData` — hence module scope, not inside `whenReady`.
 */
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "@solen", "desktop-dev"));
}

/** Coalesces a burst of filesystem events (an atomic write is itself two: temp-file create, then
 * rename) into one push to the renderer. */
const VAULT_WATCH_DEBOUNCE_MS = 400;

let adapter: FilesystemVaultAdapter | null = null;
let currentVaultPath: string | null = null;
let mainWindow: BrowserWindow | null = null;
let browserTabs: BrowserTabManager | null = null;
let terminals: TerminalManager | null = null;
const vaultWatcher = new VaultWatcher(VAULT_WATCH_DEBOUNCE_MS, () => mainWindow?.webContents.send("vault:externalChange"));
/** In-memory mirror of `desktop-config.json`, loaded once in `app.whenReady`
 * and kept in sync on every `setVaultPath` call — the recent-vaults list the
 * `vault:listRecentVaults` IPC handler serves to VaultSwitcher.tsx. */
let config: DesktopConfig = { currentVaultPath: null, recentVaults: [] };

/**
 * Resolves the vault folder to use on startup, in priority order:
 * 1. `SOLEN_VAULT_DIR` env var — lets automated tests (and power users) skip
 *    the folder-pick dialog entirely; the dialog can't be driven headlessly.
 * 2. The folder persisted from the last launch (apps/desktop/src/config.ts).
 * 3. A folder-pick dialog (openDirectory + createDirectory) — first launch.
 * Returns `null` if the user cancels the dialog with no prior vault chosen.
 */
async function resolveVaultPath(): Promise<string | null> {
  if (process.env.SOLEN_VAULT_DIR) {
    return process.env.SOLEN_VAULT_DIR;
  }

  // Only if it's still there. A saved path whose folder has since been deleted must not be
  // recreated behind the user's back (see setVaultPath) — forget it and ask, exactly as on a
  // first run. Dropping it here also keeps it out of the switcher's recents.
  if (config.currentVaultPath && existsSync(config.currentVaultPath)) return config.currentVaultPath;
  if (config.currentVaultPath) {
    config = {
      currentVaultPath: null,
      recentVaults: removeRecentVault(config.recentVaults, config.currentVaultPath),
    };
    await writeConfig(app.getPath("userData"), config);
  }

  const result = await dialog.showOpenDialog({
    title: "选择或新建知识库文件夹",
    buttonLabel: "使用此文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

/** Switches the single active vault to `vaultPath`: creates the folder if
 * needed, points a fresh `FilesystemVaultAdapter` at it, and persists the
 * choice (promoted to the front of `recentVaults`, see config.ts) so the app
 * reopens the same vault next launch and the Phase 20b vault switcher can
 * list it. Deliberately does NOT seed any content here — an empty vault
 * folder simply has no `vault.json` yet, and the renderer's own
 * `store.ts#init()` already seeds the full demo vault (via `seedDemo()`) the
 * first time it sees a vault with no meta, exactly like the browser build
 * does. Reusing that path (instead of re-implementing a second, poorer seed
 * here) means every freshly created/opened vault — first-run, "Create new
 * vault", or "Open folder as vault" alike — is byte-for-byte the same demo
 * content the browser ships if the folder is empty, written through the same
 * `vault.writeNote`/`writeCanvas`/`writeMeta` calls — which on desktop
 * resolve over IPC to this adapter, landing on disk. Callers that switch the
 * live window to this vault (as opposed to the initial launch) are
 * responsible for reloading it afterward — see `reloadWindowContent`. */
async function setVaultPath(vaultPath: string, { create }: { create: boolean }): Promise<void> {
  if (create) {
    await mkdir(vaultPath, { recursive: true });
  } else if (!existsSync(vaultPath)) {
    // Opening is NOT creating. This used to `mkdir` unconditionally, which meant clicking a
    // recent vault whose folder the user had since deleted silently rebuilt the folder — and,
    // since the rebuilt folder has no vault.json, the renderer then seeded it with the demo
    // content, so a deleted vault came back looking like a real one. A vault that is gone must
    // read as gone. Its recents entry goes with it, so the switcher stops offering a dead path.
    config = { ...config, recentVaults: removeRecentVault(config.recentVaults, vaultPath) };
    await writeConfig(app.getPath("userData"), config);
    throw new Error(`知识库文件夹已不存在：${vaultPath}`);
  }
  adapter = new FilesystemVaultAdapter(vaultPath);
  // One-time, idempotent move of a pre-.astro vault's notes/canvases/vault.json into .astro/, and
  // opaque n_….md filenames to title-mirrored ones — see docs/ARCH-VAULT-STORAGE.md problem 4.
  await adapter.migrateIfNeeded();
  currentVaultPath = vaultPath;
  vaultWatcher.start(vaultPath);
  config = { currentVaultPath: vaultPath, recentVaults: promoteRecentVault(config.recentVaults, vaultPath) };
  await writeConfig(app.getPath("userData"), config);
}

function getAdapter(): FilesystemVaultAdapter {
  if (!adapter) throw new Error("请先选择知识库文件夹");
  return adapter;
}

/** `{ path, name }` for the currently active vault, or `null` before any
 * vault has been set — the shape `vault:getCurrentVault` and
 * `vault:listRecentVaults` hand back to VaultSwitcher.tsx. `name` is just the
 * folder's basename; vaults have no separate display name of their own. */
function currentVaultInfo(): { path: string; name: string } | null {
  return currentVaultPath ? { path: currentVaultPath, name: path.basename(currentVaultPath) } : null;
}

/** Locates the built web app's `index.html`. In the monorepo (dev, or
 * `pnpm --filter @solen/desktop dev`/`start`) it's the sibling package's
 * `apps/web/dist`, two levels up from this compiled `dist/main.js`. In a
 * packaged build (see the electron-builder "build" config in package.json)
 * there's no sibling `apps/web` package on disk at all — `extraResources`
 * copies `apps/web/dist` into the packaged app's `resources/web-dist`
 * instead, which is what `app.isPackaged` switches to here. */
function resolveWebDistIndexHtml(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web-dist", "index.html");
  }
  return path.join(__dirname, "..", "..", "web", "dist", "index.html");
}

/** Locates the app icon (`build/icon.png`) so the window/taskbar show Astro's
 * logo instead of Electron's default atom — packaged builds bundle it via
 * `extraResources` the same way `resolveWebDistIndexHtml` handles web-dist. */
function resolveAppIcon(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "build", "icon.png");
  }
  return path.join(__dirname, "..", "build", "icon.png");
}

/** Locates `packages/mcp-server`'s built entry point, same packaged-vs-dev split as
 * `resolveWebDistIndexHtml`/`resolveAppIcon`: a packaged build's `extraResources` copies it in,
 * dev/repo runs read it straight from the sibling package. Returns `null` if neither exists (not
 * built yet) — callers must never write a Connections config pointing at a path that doesn't exist. */
function resolveMcpServerEntryPath(): string | null {
  const packaged = path.join(process.resourcesPath, "mcp-server", "index.js");
  if (existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, "..", "..", "..", "packages", "mcp-server", "dist", "index.js");
  if (existsSync(dev)) return dev;
  return null;
}

/** Home/appData roots for mcpConnections.ts's config-path resolvers — real ones here, a temp dir in
 * tests (see mcpConnections.test.ts). `APPDATA` is Windows-only; Claude Desktop is the only client
 * that uses it, and it isn't confirmed installed on this machine anyway (see the Connections tab). */
function mcpPathRoots(): PathRoots {
  return {
    home: os.homedir(),
    appData: process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
    localAppData: process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    programData: process.env.PROGRAMDATA ?? path.join("C:\\", "ProgramData"),
  };
}

/** Re-navigates the live `BrowserWindow` to the same place it originally
 * loaded (dev server URL, or the built web app's `index.html` — see
 * `resolveWebDistIndexHtml`) — used after `switchVault`/`createVault`/
 * `openVault` point `adapter` at a new vault folder, so the renderer's
 * `store.ts#init()` runs again from scratch against the new vault instead of
 * needing bespoke re-init plumbing. */
function reloadWindowContent(): void {
  if (!mainWindow) return;
  const devServerUrl = process.env.SOLEN_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(resolveWebDistIndexHtml());
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("vault:getMeta", () => getAdapter().getMeta());
  ipcMain.handle("vault:writeMeta", (_e, meta: VaultMeta) => getAdapter().writeMeta(meta));
  ipcMain.handle("vault:listNotes", () => getAdapter().listNotes());
  ipcMain.handle("vault:readNote", (_e, id: string) => getAdapter().readNote(id));
  ipcMain.handle("vault:writeNote", (_e, note: Note) => getAdapter().writeNote(note));
  ipcMain.handle("vault:deleteNote", (_e, id: string) => getAdapter().deleteNote(id));
  ipcMain.handle("vault:rescan", () => getAdapter().rescan());
  ipcMain.handle("vault:moveNote", (_e, id: string, folder: string | undefined) => getAdapter().moveNote(id, folder));
  ipcMain.handle("vault:listCanvases", () => getAdapter().listCanvases());
  ipcMain.handle("vault:readCanvas", (_e, id: string) => getAdapter().readCanvas(id));
  ipcMain.handle("vault:writeCanvas", (_e, doc: CanvasDoc) => getAdapter().writeCanvas(doc));
  ipcMain.handle("vault:deleteCanvas", (_e, id: string) => getAdapter().deleteCanvas(id));

  ipcMain.handle("vault:pickVaultFolder", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "选择或新建知识库文件夹",
      buttonLabel: "使用此文件夹",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return currentVaultPath;
    // `createDirectory` in the dialog options: the user may have just made this folder.
    await setVaultPath(result.filePaths[0], { create: true });
    return currentVaultPath;
  });

  ipcMain.handle("vault:getCurrentVaultPath", () => currentVaultPath);

  // --- Phase 20b: multi-vault switcher (VaultSwitcher.tsx) ------------------

  // `exists` is reported, not acted on: a missing folder is shown as unavailable rather than
  // quietly dropped, because "missing" also describes an unplugged drive or an offline network
  // share, and forgetting those on a routine list call would lose the entry for good. Entries are
  // only pruned when the user actually tries to open one and it really is gone (setVaultPath).
  ipcMain.handle("vault:listRecentVaults", () =>
    config.recentVaults.map((p) => ({ path: p, name: path.basename(p), exists: existsSync(p) })),
  );

  ipcMain.handle("vault:getCurrentVault", () => currentVaultInfo());

  ipcMain.handle("vault:createVault", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "新建知识库文件夹",
      buttonLabel: "创建知识库",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return currentVaultInfo();
    await setVaultPath(result.filePaths[0], { create: true });
    reloadWindowContent();
    return currentVaultInfo();
  });

  ipcMain.handle("vault:openVault", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "打开已有知识库文件夹",
      buttonLabel: "打开知识库",
      properties: ["openDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return currentVaultInfo();
    // The dialog is `openDirectory` without `createDirectory`, so this path already exists —
    // `create: false` just keeps "Open" honest about never fabricating a vault.
    await setVaultPath(result.filePaths[0], { create: false });
    reloadWindowContent();
    return currentVaultInfo();
  });

  ipcMain.handle("vault:switchVault", async (_e, vaultPath: string) => {
    // From the recents list, which can name a folder the user has since deleted. Never create.
    await setVaultPath(vaultPath, { create: false });
    reloadWindowContent();
  });

  // Window controls (WindowControls.tsx). The buttons are ordinary DOM now — see createWindow for
  // why the native overlay was dropped — so the main process only has to perform the actions.
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggleMaximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

  // --- In-app browser (BrowserPanel.tsx), backed by BrowserTabManager's WebContentsViews ------
  ipcMain.handle("browser:createTab", (_e, url: string) => browserTabs?.createTab(url));
  ipcMain.handle("browser:closeTab", (_e, id: string) => browserTabs?.closeTab(id));
  ipcMain.handle("browser:setActiveTab", (_e, id: string | null) => browserTabs?.setActiveTab(id));
  ipcMain.handle("browser:setBounds", (_e, rect: Rectangle) => browserTabs?.setBounds(rect));
  ipcMain.handle("browser:navigate", (_e, id: string, url: string) => browserTabs?.navigate(id, url));
  ipcMain.handle("browser:goBack", (_e, id: string) => browserTabs?.goBack(id));
  ipcMain.handle("browser:goForward", (_e, id: string) => browserTabs?.goForward(id));
  ipcMain.handle("browser:reload", (_e, id: string) => browserTabs?.reload(id));
  ipcMain.handle("browser:stop", (_e, id: string) => browserTabs?.stop(id));
  ipcMain.handle("browser:openExternally", (_e, id: string) => browserTabs?.openExternally(id));
  ipcMain.handle("browser:listTabs", () => browserTabs?.listTabs() ?? []);
  ipcMain.handle("browser:hideAll", () => browserTabs?.hideAll());
  ipcMain.handle("browser:showActive", () => browserTabs?.showActive());

  // --- Integrated terminal (TerminalPanel.tsx), backed by TerminalManager's spawned shells -----
  // `cwd` is never taken from the renderer (see terminal.ts's security note) — main decides it
  // from its own `currentVaultPath`, same as `setVaultPath` already does for the filesystem vault.
  ipcMain.handle("terminal:create", (_e, cols: number, rows: number) => terminals?.create(currentVaultPath, cols, rows));
  ipcMain.handle("terminal:write", (_e, id: string, data: string) => terminals?.write(id, data));
  ipcMain.handle("terminal:resize", (_e, id: string, cols: number, rows: number) => terminals?.resize(id, cols, rows));
  ipcMain.handle("terminal:kill", (_e, id: string) => terminals?.kill(id));

  // --- Google sign-in (Settings → Account), see googleAuth.ts's PKCE loopback flow -------------
  // The client id belongs to the user's own Google Cloud OAuth client and is passed in from the
  // renderer's settings; no token ever comes back across this boundary, only the profile.
  ipcMain.handle("google:signIn", (_e, clientId: string) => googleSignIn(clientId));
  ipcMain.handle("google:signOut", () => googleSignOut());
  ipcMain.handle("google:getProfile", () => currentGoogleProfile());

  // --- Constellation database (docs/ARCH-CONSTELLATIONS.md) ------------------------------------
  ipcMain.handle("constellations:download", () => downloadConstellationPatterns(app.getPath("userData")));
  ipcMain.handle("constellations:getCached", () => getCachedConstellationPatterns(app.getPath("userData")));

  // --- MCP Connections (Settings → Connections), see mcpConnections.ts -------------------------
  // The renderer only ever sends a client id from VERIFIED_CLIENTS' known table — never a path or
  // command — so an unrecognized id is rejected outright rather than trusted.
  // No vault gating here any more: the written config carries no vault path, so connecting a client
  // is independent of which vault (if any) is open right now.
  ipcMain.handle("mcp:listClients", async () => {
    const entryPath = resolveMcpServerEntryPath();
    const roots = mcpPathRoots();
    // Gathered once for the whole list — reading the uninstall registry and walking both Start
    // Menus per client would repeat the same two scans six times over. See clientDetect.ts.
    const probes = await collectDetectionProbes(roots);
    const clients = await Promise.all(VERIFIED_CLIENTS.map((c) => getClientStatus(c, roots, entryPath, probes)));
    return { entryPath, clients, unverified: UNVERIFIED_CLIENTS };
  });

  ipcMain.handle("mcp:connect", (_e, id: string) => {
    const client = VERIFIED_CLIENTS.find((c) => c.id === id);
    if (!client) throw new Error(`未知的工具编号：${id}`);
    const entryPath = resolveMcpServerEntryPath();
    if (!entryPath) throw new Error("工具连接服务尚未构建，请先构建 MCP 服务。");
    return connectClient(client, mcpPathRoots(), entryPath);
  });

  ipcMain.handle("mcp:disconnect", (_e, id: string) => {
    const client = VERIFIED_CLIENTS.find((c) => c.id === id);
    if (!client) throw new Error(`未知的工具编号：${id}`);
    return disconnectClient(client, mcpPathRoots());
  });

  // "How do I know it's actually connected?" — Astro can't observe a client reading its config, but
  // it can reproduce the chain the config points at: spawn the server, handshake, list notes.
  ipcMain.handle("mcp:test", async () => {
    const entryPath = resolveMcpServerEntryPath();
    if (!entryPath) return { ok: false, error: "工具连接服务尚未构建，请先构建 MCP 服务。" };
    return probeMcpServer(entryPath);
  });

  ipcMain.handle("mcp:revealConfig", async (_e, id: string) => {
    const client = VERIFIED_CLIENTS.find((c) => c.id === id);
    if (!client) throw new Error(`未知的工具编号：${id}`);
    const configPath = await resolveConfigPath(client, mcpPathRoots());
    if (existsSync(configPath)) {
      shell.showItemInFolder(configPath);
    } else {
      // Nothing written yet — showItemInFolder on a missing file does nothing, which reads as the
      // button being broken. Open the folder instead so the user always sees something happen.
      await shell.openPath(path.dirname(configPath));
    }
  });
}

function createWindow(): void {
  // No Windows/Linux menu bar (File/Edit/View/Window/Help) — the app has its own in-window
  // Ribbon/command palette for every action that menu would offer, and the bar reads as
  // stock-Electron chrome against the rest of the native-feeling design.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0b0b12",
    icon: resolveAppIcon(),
    // Electron's native title bar is always OS-themed (light on Windows regardless of the app's
    // own dark CSS), so it's hidden and the app draws its own controls (WindowControls.tsx).
    //
    // Deliberately NO `titleBarOverlay`. That overlay is native chrome painted on top of the web
    // contents, which means it cannot participate in anything the app renders: `.overlay-backdrop`
    // dims the whole window for a modal and the overlay stayed at full brightness (a white
    // rectangle in the corner of a dimmed light theme), and Settings → Interface zoom scales the
    // DOM while the overlay stays a fixed 32px. Both are the same defect — a foreign rectangle —
    // and chasing them with `setTitleBarOverlay` calls only ever patched one instance at a time.
    // DOM buttons dim, scale, hover and theme themselves, for free.
    titleBarStyle: "hidden",
    webPreferences: {
      // Electron's preload loader picks CommonJS vs ESM off the file
      // extension, not off webPreferences.sandbox or the package's own
      // "type": "module" — a plain "preload.js" here silently fails with
      // "require() of ES Module preload.js not supported" and the renderer
      // never gets `window.vaultAPI` (this went unnoticed because the app
      // still ran, just silently on IndexedDB instead of the filesystem
      // vault). Compiling from preload.mts gives tsc an .mjs output, which
      // Electron does load as ESM.
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Not sandboxed: sandboxed preload scripts can't use ES module
      // import/export (see https://www.electronjs.org/docs/latest/tutorial/esm).
      // `contextIsolation: true` + `nodeIntegration: false` is what actually
      // keeps the renderer from touching Node/Electron internals — the
      // preload only ever exposes the narrow `vaultAPI` surface below via
      // `contextBridge`, never `require` or `ipcRenderer` itself.
      sandbox: false,
    },
  });

  // The in-app browser (BrowserPanel.tsx) is backed by WebContentsViews layered on this window's
  // own contentView — see browserTabs.ts. Each tab gets its own locked-down webPreferences
  // (contextIsolation/sandbox/no nodeIntegration), independent of the main window's above.
  browserTabs = new BrowserTabManager(
    () => mainWindow,
    (event: BrowserTabEvent) => mainWindow?.webContents.send("browser:event", event),
  );

  terminals = new TerminalManager((event: TerminalEvent) => mainWindow?.webContents.send("terminal:event", event));

  // Defense-in-depth for the in-app browser: the renderer intercepts external
  // link clicks in rendered markdown and routes them to the in-app browser panel,
  // but should anything slip through, never let the top-level app frame
  // navigate away from its own bundle or spawn an OS window.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // The maximize/restore button has to show which of the two it is, and the window can be
  // maximized without it — a double-click on the drag region, Win+Up, or the OS snap gesture —
  // so push the state rather than letting the renderer poll for it.
  const sendMaximized = (maximized: boolean) => mainWindow?.webContents.send("window:maximizedChanged", maximized);
  mainWindow.on("maximize", () => sendMaximized(true));
  mainWindow.on("unmaximize", () => sendMaximized(false));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  // In dev, load the Vite dev server for hot reload; SOLEN_DEV_SERVER_URL is
  // set by `pnpm --filter @solen/desktop dev` tooling / manually during
  // development. Otherwise load the built web app from apps/web/dist. Same
  // logic `reloadWindowContent` reuses when switching vaults.
  reloadWindowContent();

  mainWindow.on("closed", () => {
    mainWindow = null;
    browserTabs = null;
    // Must happen here, not in `window-all-closed` — that fires *after* this handler, by which
    // point `terminals` is already null and every spawned shell would outlive the app as an
    // orphaned process.
    terminals?.killAll();
    terminals = null;
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();

  config = await readConfig(app.getPath("userData"));
  const vaultPath = await resolveVaultPath();
  if (!vaultPath) {
    app.quit();
    return;
  }
  // `create: true` is safe here precisely because `resolveVaultPath` never returns a remembered
  // path that has gone missing: what reaches this line is either an existing folder, a folder the
  // user just picked/created in the dialog, or an explicit `SOLEN_VAULT_DIR` (documented in
  // docs/DESKTOP.md as opening that folder directly, creating it for scripted runs).
  await setVaultPath(vaultPath, { create: true });

  createWindow();

  // First-run download of the real constellation database (docs/ARCH-CONSTELLATIONS.md) — never
  // blocks window creation; a bundled fallback (apps/web/src/graph3d/layouts/patterns.ts) already
  // covers a fully offline first run, so a failed/slow fetch here is silently non-fatal.
  getCachedConstellationPatterns(app.getPath("userData")).then((cached) => {
    if (!cached) void downloadConstellationPatterns(app.getPath("userData")).catch(() => undefined);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
