import { useEffect, useState } from "react";
import { FolderOpen, Plus, PanelLeft, Orbit, SlidersHorizontal, Sparkles, Settings, Sun, Moon, SquareTerminal, Blocks } from "lucide-react";
import { useStore } from "../store";
import { usePluginStore } from "../plugins/store";

/**
 * Leftmost vertical icon rail — always visible, the app's primary chrome
 * anchor. Owns the actions that used to live in Sidebar.tsx's header row,
 * Vault row, and Theme row: new note, sidebar/constellation/AI/plugin
 * toggles, settings, and the theme switch. Vault export/import moved to the
 * Command Palette (Ctrl+K) — see CommandPalette.tsx. Every button is a plain
 * 32×32 `.ribbon-btn` with a CSS-only tooltip via `data-tip` (see
 * index.css) — no `title` attributes here.
 */
export function Ribbon() {
  const createNote = useStore((s) => s.createNote);
  const openNote = useStore((s) => s.openNote);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const graphMode = useStore((s) => s.graphMode);
  const toggleGraphMode = useStore((s) => s.toggleGraphMode);
  const graphPanelOpen = useStore((s) => s.graphPanelOpen);
  const toggleGraphPanel = useStore((s) => s.toggleGraphPanel);
  const aiPanelOpen = useStore((s) => s.aiPanelOpen);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const openSettings = useStore((s) => s.openSettings);
  const openVaultSwitcher = useStore((s) => s.openVaultSwitcher);
  const pluginDrawerOpen = usePluginStore((s) => s.drawerOpen);
  const togglePluginDrawer = usePluginStore((s) => s.toggleDrawer);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  // `window.vaultAPI` only exists under Electron (see apps/desktop/src/preload.ts) — the browser
  // build keeps its single IndexedDB vault and never shows this button or VaultSwitcher.tsx at
  // all. Computed once per mount rather than per-render since it can't change at runtime.
  const [hasVaultApi] = useState(() => typeof window !== "undefined" && !!window.vaultAPI);
  const [currentVaultName, setCurrentVaultName] = useState<string | null>(null);
  // window.terminalAPI only exists under Electron (see apps/desktop/src/preload.mts) — the
  // browser build has no shell to spawn, so this button (and TerminalPanel.tsx) never renders.
  const [hasTerminalApi] = useState(() => typeof window !== "undefined" && !!window.terminalAPI);

  useEffect(() => {
    if (!hasVaultApi) return;
    void window.vaultAPI?.getCurrentVault().then((v) => setCurrentVaultName(v?.name ?? null));
  }, [hasVaultApi]);

  async function handleCreateNote() {
    const note = await createNote();
    await openNote(note.id);
  }

  return (
    <nav className="ribbon" aria-label="主工具栏">
      <div className="ribbon-logo" aria-hidden="true">
        {/* import.meta.env.BASE_URL (not a hardcoded "/logo.svg") so this
            still resolves under Electron's file:// (base: "./", see
            vite.config.ts) as well as the browser build. */}
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Astro" width={22} height={22} />
      </div>

      {/* Desktop-only (Electron): switch between vault folders — see VaultSwitcher.tsx. Absent
          in the browser build, which only ever has the one IndexedDB vault. */}
      {hasVaultApi && (
        <button
          onClick={openVaultSwitcher}
          data-tip={currentVaultName ? `知识库：${currentVaultName}` : "知识库"}
          aria-label="切换知识库"
          className="ribbon-btn"
        >
          <FolderOpen size={16} />
        </button>
      )}

      <button onClick={() => void handleCreateNote()} data-tip="新建笔记" aria-label="新建笔记" className="ribbon-btn">
        <Plus size={16} />
      </button>

      <button
        onClick={toggleSidebar}
        data-tip={sidebarOpen ? "收起笔记列表（Ctrl+B）" : "展开笔记列表（Ctrl+B）"}
        aria-label="展开或收起笔记列表"
        aria-pressed={sidebarOpen}
        className={`ribbon-btn ${sidebarOpen ? "active" : ""}`}
      >
        <PanelLeft size={16} />
      </button>

      <button
        onClick={toggleGraphMode}
        data-tip="切换星座排列（Ctrl+G）"
        aria-label="切换星座排列"
        aria-pressed={graphMode === "constellation"}
        className={`ribbon-btn ${graphMode === "constellation" ? "active" : ""}`}
      >
        <Orbit size={16} />
      </button>

      <button
        onClick={toggleGraphPanel}
        data-tip="星图设置"
        aria-label="星图设置"
        aria-pressed={graphPanelOpen}
        className={`ribbon-btn ${graphPanelOpen ? "active" : ""}`}
      >
        <SlidersHorizontal size={16} />
      </button>

      <button
        onClick={toggleAIPanel}
        data-tip="智能助手（Ctrl+J）"
        aria-label="展开或收起智能助手"
        aria-pressed={aiPanelOpen}
        className={`ribbon-btn ${aiPanelOpen ? "active" : ""}`}
      >
        <Sparkles size={16} />
      </button>

      <button
        onClick={togglePluginDrawer}
        data-tip="插件"
        aria-label="展开或收起插件面板"
        aria-pressed={pluginDrawerOpen}
        className={`ribbon-btn ${pluginDrawerOpen ? "active" : ""}`}
      >
        <Blocks size={16} />
      </button>

      {/* Desktop-only (Electron): the integrated terminal — see TerminalPanel.tsx. Absent in the
          browser build, which has no shell process to spawn. */}
      {hasTerminalApi && (
        <button
          onClick={toggleTerminal}
          data-tip="命令终端"
          aria-label="展开或收起命令终端"
          aria-pressed={terminalOpen}
          className={`ribbon-btn ${terminalOpen ? "active" : ""}`}
        >
          <SquareTerminal size={16} />
        </button>
      )}

      <div className="ribbon-spacer" />

      <button onClick={() => openSettings()} data-tip="设置" aria-label="设置" className="ribbon-btn">
        <Settings size={16} />
      </button>

      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        data-tip={theme === "dark" ? "切换为浅色界面" : "切换为深色界面"}
        aria-label="切换深色或浅色界面"
        className="ribbon-btn"
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </nav>
  );
}
