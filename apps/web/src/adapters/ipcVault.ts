import type { CanvasDoc, CanvasMeta, Note, NoteMeta, VaultAdapter, VaultMeta } from "@solen/core";

/** `{ path, name }` for a vault folder — `name` is just the folder's
 * basename. Returned by the Phase 20b multi-vault methods below; see
 * VaultSwitcher.tsx, the only caller. */
export interface VaultInfo {
  path: string;
  name: string;
  /** Whether the folder is still on disk. Only `listRecentVaults` reports it — a remembered vault
   * can be deleted, or sit on a drive that isn't plugged in, and the switcher says so instead of
   * offering a row that cannot open. Absent (undefined) means "not checked", which reads as
   * available. */
  exists?: boolean;
}

/**
 * The vault surface Electron's preload script exposes on `window.vaultAPI`
 * (see apps/desktop/src/preload.ts's `contextBridge.exposeInMainWorld` call).
 * Declared independently here rather than imported from @solen/desktop so
 * the browser bundle never depends on (or accidentally pulls in) the
 * Node-only desktop package — this file only ever calls methods on a global
 * `window` property, no Node APIs.
 */
export interface VaultApi {
  getMeta(): Promise<VaultMeta | undefined>;
  writeMeta(meta: VaultMeta): Promise<void>;
  listNotes(): Promise<NoteMeta[]>;
  readNote(id: string): Promise<Note>;
  writeNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  rescan(): Promise<NoteMeta[]>;
  moveNote(id: string, folder: string | undefined): Promise<void>;
  /** Subscribes to the main process's live vault-folder watcher (see
   * apps/desktop/src/vaultWatcher.ts); returns an unsubscribe function. */
  onExternalChange(cb: () => void): () => void;
  listCanvases(): Promise<CanvasMeta[]>;
  readCanvas(id: string): Promise<CanvasDoc>;
  writeCanvas(doc: CanvasDoc): Promise<void>;
  deleteCanvas(id: string): Promise<void>;
  /** Opens the native folder-pick dialog and switches the active vault;
   * resolves to the newly chosen path, or the still-current path if the
   * user cancels. Superseded by the Phase 20b methods below for the vault
   * switcher UI, but kept for backward compatibility. */
  pickVaultFolder(): Promise<string | null>;
  getCurrentVaultPath(): Promise<string | null>;

  /** Phase 20b multi-vault switcher (VaultSwitcher.tsx) — called directly on
   * `window.vaultAPI` by that component rather than through `IpcVaultAdapter`
   * below, since `VaultAdapter` (@solen/core) has no notion of "the whole
   * list of vaults", only "the current one". */
  /** Most-recent-first list of previously opened vault folders (see
   * apps/desktop/src/config.ts's `recentVaults`). */
  listRecentVaults(): Promise<VaultInfo[]>;
  /** Opens a folder-pick dialog (new or existing, empty folders allowed),
   * switches the active vault to it, and reloads the window so the renderer
   * re-initializes against it. Resolves to the newly chosen vault, or the
   * still-current one if the dialog is canceled. */
  createVault(): Promise<VaultInfo | null>;
  /** Opens a folder-pick dialog restricted to existing folders, switches the
   * active vault to it, and reloads the window. Resolves to the newly chosen
   * vault, or the still-current one if the dialog is canceled. */
  openVault(): Promise<VaultInfo | null>;
  /** Switches the active vault to `path` (a folder already in
   * `listRecentVaults()`, typically) and reloads the window — no dialog. */
  switchVault(path: string): Promise<void>;
  /** The vault currently open, or `null` if somehow none has been set yet. */
  getCurrentVault(): Promise<VaultInfo | null>;
}

declare global {
  interface Window {
    /** Present only inside the Electron desktop app (set by
     * apps/desktop/src/preload.ts); absent in the browser. store.ts uses its
     * presence to pick `IpcVaultAdapter` vs. `IndexedDbVault` at runtime. */
    vaultAPI?: VaultApi;
    /** Present only inside the Electron desktop app — backs the app's own minimize/maximize/close
     * buttons (WindowControls.tsx). Electron's native overlay is deliberately not used; see
     * apps/desktop/src/main.ts's createWindow. */
    windowAPI?: {
      /** `process.platform` from the main process — macOS keeps its native traffic lights, so the
       * DOM controls must not render there. */
      platform: string;
      minimize(): Promise<void>;
      toggleMaximize(): Promise<void>;
      close(): Promise<void>;
      isMaximized(): Promise<boolean>;
      /** Subscribes to maximize/restore (including OS-initiated ones: snap, Win+Up, double-click
       * on the drag region). Returns an unsubscribe function. */
      onMaximizedChange(cb: (maximized: boolean) => void): () => void;
    };
  }
}

/**
 * `VaultAdapter` implementation for the Electron desktop build: every method
 * just forwards to `window.vaultAPI`, which IPC-invokes the main process's
 * `FilesystemVaultAdapter` (apps/desktop/src/filesystemVault.ts). Contains no
 * Node imports itself, so it's safe to bundle into the browser build too —
 * it simply never gets *constructed* there, since `window.vaultAPI` is only
 * ever present under Electron (see store.ts's adapter selection).
 */
export class IpcVaultAdapter implements VaultAdapter {
  private api(): VaultApi {
    const api = window.vaultAPI;
    if (!api) {
      throw new Error("此功能需要使用 Astro 桌面版。");
    }
    return api;
  }

  getMeta(): Promise<VaultMeta | undefined> {
    return this.api().getMeta();
  }

  writeMeta(meta: VaultMeta): Promise<void> {
    return this.api().writeMeta(meta);
  }

  listNotes(): Promise<NoteMeta[]> {
    return this.api().listNotes();
  }

  readNote(id: string): Promise<Note> {
    return this.api().readNote(id);
  }

  writeNote(note: Note): Promise<void> {
    return this.api().writeNote(note);
  }

  deleteNote(id: string): Promise<void> {
    return this.api().deleteNote(id);
  }

  rescan(): Promise<NoteMeta[]> {
    return this.api().rescan();
  }

  moveNote(id: string, folder: string | undefined): Promise<void> {
    return this.api().moveNote(id, folder);
  }

  listCanvases(): Promise<CanvasMeta[]> {
    return this.api().listCanvases();
  }

  readCanvas(id: string): Promise<CanvasDoc> {
    return this.api().readCanvas(id);
  }

  writeCanvas(doc: CanvasDoc): Promise<void> {
    return this.api().writeCanvas(doc);
  }

  deleteCanvas(id: string): Promise<void> {
    return this.api().deleteCanvas(id);
  }
}
