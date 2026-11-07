import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { VaultInfo } from "../adapters/ipcVault";
import { tildeHome } from "../mcpPaths";

/**
 * Desktop-only modal (Electron; see apps/desktop) listing every vault folder
 * the user has previously opened — like a "recent projects" screen — plus
 * actions to create a brand-new vault folder or open an existing one as a
 * vault. Reachable from the ribbon's vault button, which itself only renders
 * when `window.vaultAPI` exists (Ribbon.tsx), so this component never
 * mounts-and-shows anything in the browser build; it also independently
 * bails out below if `window.vaultAPI` is somehow absent, since it reads it
 * directly rather than through `IpcVaultAdapter` (`VaultAdapter` has no
 * notion of "the whole vault list", only "the current one" — see
 * apps/web/src/adapters/ipcVault.ts).
 *
 * Every action (recent-vault click, Create, Open) that actually switches the
 * vault has the *main* process reload the whole `BrowserWindow` afterward
 * (apps/desktop/src/main.ts's `reloadWindowContent`) rather than this
 * component trying to re-init the store in place — so there's nothing to do
 * here after `switchVault`/`createVault`/`openVault` resolve except stay
 * disabled until the reload lands.
 */
export function VaultSwitcher() {
  const open = useStore((s) => s.vaultSwitcherOpen);
  const close = useStore((s) => s.closeVaultSwitcher);
  const [recents, setRecents] = useState<VaultInfo[]>([]);
  const [current, setCurrent] = useState<VaultInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const api = window.vaultAPI;
    if (!api) return;
    let cancelled = false;
    void Promise.all([api.listRecentVaults(), api.getCurrentVault()]).then(([list, cur]) => {
      if (cancelled) return;
      setRecents(list);
      setCurrent(cur);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const api = typeof window !== "undefined" ? window.vaultAPI : undefined;
  if (!open || !api) return null;

  async function handleSwitch(vaultPath: string) {
    if (busy || !api) return;
    setBusy(true);
    setError(null);
    try {
      await api.switchVault(vaultPath);
      // main.ts reloads the whole window on a successful switch — nothing
      // more to do here; leave `busy` true so the list stays disabled until
      // that reload lands (or reset it below if the call itself threw).
    } catch (err) {
      // Almost always "this folder is gone" (main.ts refuses to recreate a deleted vault). Saying
      // nothing here was how a failed switch looked identical to a click that did nothing.
      // Electron wraps a rejected `ipcMain.handle` as "Error invoking remote method 'x': Error: real
      // message" — the user needs the tail, not the plumbing.
      const raw = err instanceof Error ? err.message : "";
      setError(raw.split("出错了：").pop()?.trim() || "无法打开这个知识库。");
      setBusy(false);
      void api.listRecentVaults().then(setRecents);
    }
  }

  async function handleCreate() {
    if (busy || !api) return;
    setBusy(true);
    try {
      await api.createVault();
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    if (busy || !api) return;
    setBusy(true);
    try {
      await api.openVault();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div className="palette-panel vault-switcher-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vault-switcher-header">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Astro" width={28} height={28} />
          <h2>知识库</h2>
          <button className="settings-close" onClick={close} title="关闭（Esc）">
            ×
          </button>
        </div>

        <div className="vault-switcher-actions">
          <button className="connection-chip connect" onClick={() => void handleCreate()} disabled={busy}>
            新建知识库
          </button>
          <button className="connection-chip" onClick={() => void handleOpen()} disabled={busy}>
            打开已有知识库文件夹
          </button>
        </div>

        {error && <p className="vault-switcher-error">{error}</p>}

        <ul className="vault-switcher-list">
          {recents.map((v) => {
            const isCurrent = current?.path === v.path;
            // `exists === false` only ever comes from listRecentVaults; anything else (including
            // the browser build's shape, which has no such field) counts as available.
            const missing = v.exists === false;
            return (
              <li key={v.path}>
                <button
                  className={`vault-switcher-item ${isCurrent ? "active" : ""} ${missing ? "missing" : ""}`}
                  onClick={() => void handleSwitch(v.path)}
                  disabled={busy || missing}
                  title={missing ? "这个文件夹已不存在" : undefined}
                >
                  <span className="vault-switcher-item-text">
                    <span className="vault-switcher-name">{v.name}</span>
                    {/* Same treatment as Settings → Connections: a vault list is one of the two
                        panes people screenshot, and the raw path publishes their account name. */}
                    <span className="vault-switcher-path" title={v.path}>{tildeHome(v.path)}</span>
                  </span>
                  {isCurrent && <span className="vault-switcher-current-badge">当前使用</span>}
                  {missing && !isCurrent && <span className="vault-switcher-missing-badge">文件夹不存在</span>}
                </button>
              </li>
            );
          })}
          {recents.length === 0 && <li className="palette-empty">暂无最近使用的知识库</li>}
        </ul>
      </div>
    </div>
  );
}
