import { watch, type FSWatcher } from "node:fs";

/**
 * Watches a vault folder for changes made outside the app (an Explorer rename/edit/delete, a file
 * dropped in) and calls `onChange` once the burst of filesystem events settles — replaces the
 * earlier "re-scan on window focus" approach (see docs/ARCH-VAULT-STORAGE.md problem 2) with a
 * real live watcher, per user request: changes now propagate immediately instead of waiting for
 * the window to regain focus.
 *
 * Built on Node's own `fs.watch({ recursive: true })` — supported natively on Windows and macOS
 * (this app's targets), so no new dependency (chokidar) is needed. Debounced because a single
 * logical write is itself several filesystem events (atomicWriteFile's temp-file-then-rename is
 * two), and because the app's own saves land here too — rescanVault() on the renderer side is
 * idempotent (a no-op diff against unchanged state), so re-triggering on our own writes is wasted
 * work, not a correctness bug, and the debounce keeps that waste to one rescan per burst.
 */
export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly debounceMs: number,
    private readonly onChange: () => void,
  ) {}

  start(vaultDir: string): void {
    this.stop();
    try {
      this.watcher = watch(vaultDir, { recursive: true }, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.onChange();
        }, this.debounceMs);
      });
      // Watching a folder that gets deleted out from under us shouldn't crash the app.
      this.watcher.on("error", () => this.stop());
    } catch {
      // fs.watch can throw synchronously on some platforms/paths (e.g. a network drive that
      // doesn't support recursive watching) — the app still works, just without live external
      // change detection; nothing else here depends on this succeeding.
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }
}
