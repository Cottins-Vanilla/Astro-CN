import { BrowserWindow, WebContentsView, shell, type Rectangle } from "electron";

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

let nextId = 1;

/**
 * Manages the in-app browser's tabs as Electron `WebContentsView`s layered on top of the main
 * window's own content view — the officially recommended replacement for the deprecated
 * `BrowserView` (and the legacy `<webview>` tag, which this replaces; see
 * https://www.electronjs.org/docs/latest/api/web-contents-view). Only the active tab's view is
 * attached (and positioned over BrowserPanel.tsx's viewport element via `setBounds`, driven by the
 * renderer reporting its `getBoundingClientRect()`); inactive tabs stay detached but keep their
 * `WebContents` alive so their navigation history and scroll position survive switching back.
 */
export class BrowserTabManager {
  private readonly tabs = new Map<string, WebContentsView>();
  private order: string[] = [];
  private activeId: string | null = null;
  private lastBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly emit: (event: BrowserTabEvent) => void,
  ) {}

  private stateOf(id: string): BrowserTabState {
    const view = this.tabs.get(id);
    const wc = view?.webContents;
    return {
      id,
      url: wc?.getURL() ?? "",
      title: wc?.getTitle() ?? "",
      loading: wc?.isLoading() ?? false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false,
    };
  }

  private wire(id: string, view: WebContentsView): void {
    const wc = view.webContents;
    const push = () => this.emit({ type: "updated", tab: this.stateOf(id) });
    wc.on("did-start-loading", push);
    wc.on("did-stop-loading", push);
    wc.on("did-navigate", push);
    wc.on("did-navigate-in-page", push);
    wc.on("page-title-updated", push);
    wc.on("did-fail-load", (_e, errorCode) => {
      if (errorCode === -3) return; // aborted (e.g. a redirect) — not a real failure
      push();
    });
    // A target="_blank" link or window.open() opens as a new tab in-panel, never a bare OS
    // window — the user only reaches the OS browser via the explicit "open externally" action.
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: "deny" };
    });
  }

  createTab(url: string): string {
    const id = String(nextId++);
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.tabs.set(id, view);
    this.order.push(id);
    this.wire(id, view);
    void view.webContents.loadURL(url);
    this.emit({ type: "created", tab: this.stateOf(id) });
    this.setActiveTab(id);
    return id;
  }

  closeTab(id: string): void {
    const view = this.tabs.get(id);
    if (!view) return;
    const win = this.getWindow();
    if (this.activeId === id) win?.contentView.removeChildView(view);
    (view.webContents as unknown as { close?: () => void }).close?.();
    this.tabs.delete(id);
    this.order = this.order.filter((t) => t !== id);
    this.emit({ type: "closed", id });
    if (this.activeId === id) {
      const next = this.order[this.order.length - 1] ?? null;
      this.setActiveTab(next);
    }
  }

  setActiveTab(id: string | null): void {
    const win = this.getWindow();
    if (win && this.activeId) {
      const prev = this.tabs.get(this.activeId);
      if (prev) win.contentView.removeChildView(prev);
    }
    this.activeId = id;
    if (win && id) {
      const view = this.tabs.get(id);
      if (view) {
        win.contentView.addChildView(view);
        view.setBounds(this.lastBounds);
      }
    }
    this.emit({ type: "activated", id });
  }

  /** Positions the active tab's view over BrowserPanel.tsx's viewport element — called on every
   * resize/scroll of that element in the renderer, since a `WebContentsView` is a native layer
   * unaware of DOM layout and must be told its rectangle explicitly. */
  setBounds(rect: Rectangle): void {
    this.lastBounds = rect;
    const view = this.activeId ? this.tabs.get(this.activeId) : undefined;
    view?.setBounds(rect);
  }

  navigate(id: string, url: string): void {
    void this.tabs.get(id)?.webContents.loadURL(url);
  }

  goBack(id: string): void {
    this.tabs.get(id)?.webContents.navigationHistory.goBack();
  }

  goForward(id: string): void {
    this.tabs.get(id)?.webContents.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.tabs.get(id)?.webContents.reload();
  }

  stop(id: string): void {
    this.tabs.get(id)?.webContents.stop();
  }

  /** The one path to the OS's own default browser — never automatic, only ever this explicit call. */
  openExternally(id: string): void {
    const url = this.tabs.get(id)?.webContents.getURL();
    if (url) void shell.openExternal(url);
  }

  listTabs(): BrowserTabState[] {
    return this.order.map((id) => this.stateOf(id));
  }

  /** Hides every tab's view without closing them — used when BrowserPanel.tsx's floating panel is
   * closed, so the native layer doesn't keep painting over the graph behind it. */
  hideAll(): void {
    const win = this.getWindow();
    if (win && this.activeId) {
      const view = this.tabs.get(this.activeId);
      if (view) win.contentView.removeChildView(view);
    }
  }

  /** Re-attaches the active tab's view — the counterpart to `hideAll`, called when the panel
   * reopens. */
  showActive(): void {
    const win = this.getWindow();
    if (win && this.activeId) {
      const view = this.tabs.get(this.activeId);
      if (view) {
        win.contentView.addChildView(view);
        view.setBounds(this.lastBounds);
      }
    }
  }
}
