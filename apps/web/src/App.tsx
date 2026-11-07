import { useEffect, useLayoutEffect } from "react";
import { useStore } from "./store";
import { Ribbon } from "./components/Ribbon";
import { Sidebar } from "./components/Sidebar";
import { NoteEditor } from "./components/NoteEditor";
import { CommandPalette } from "./components/CommandPalette";
import { GraphView3D } from "./graph3d/GraphView3D";
import { AIPanel } from "./components/AIPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { TabWorkspaceStrip } from "./components/TabWorkspaceStrip";
import { WebViewport } from "./components/WebViewport";
import { NewTabPage } from "./components/NewTabPage";
import { PluginDrawer } from "./components/PluginDrawer";
import { SettingsModal } from "./components/SettingsModal";
import { StatusBar } from "./components/StatusBar";
import { VaultSwitcher } from "./components/VaultSwitcher";
import { loadPlugins } from "./plugins/manager";
import { setActivePatterns } from "./graph3d/layouts/constellation";
import { usePluginStore } from "./plugins/store";

declare global {
  interface Window {
    constellationsAPI?: {
      getCached(): Promise<Array<{ id: string; name: string; stars: { x: number; y: number }[]; parent: number[] }> | null>;
      download(): Promise<Array<{ id: string; name: string; stars: { x: number; y: number }[]; parent: number[] }>>;
    };
  }
}

export function App() {
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const theme = useStore((s) => s.theme);
  const accentColor = useStore((s) => s.accentColor);
  const uiZoom = useStore((s) => s.uiZoom);
  const toggleGraphMode = useStore((s) => s.toggleGraphMode);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    void init().then(() => void loadPlugins());
  }, [init]);

  // Prefer a downloaded constellation database over the build-time-bundled fallback, if one's
  // been cached — see docs/ARCH-CONSTELLATIONS.md. Absent under the browser/IndexedDB build
  // (no window.constellationsAPI there), which just keeps the bundled set.
  useEffect(() => {
    void window.constellationsAPI?.getCached().then((cached) => {
      if (cached && cached.length > 0) setActivePatterns(cached);
    });
  }, []);

  // A layout effect (not a plain effect) so this always lands on <html> before any *child's*
  // effect runs — React flushes layout effects child-before-parent within a phase, but ALL layout
  // effects still run before ANY passive effect. GraphView3D's theme-sync effect reads computed
  // CSS custom properties off document.documentElement; if this were a plain useEffect instead, it
  // (declared on the parent) would fire after that child effect in the same commit and the 3D
  // scene would re-tint one theme toggle behind the actual data-theme attribute.
  // Combined with the accent-color override (docs/ARCH-APPEARANCE.md §2) so both land before the
  // title-bar effect below reads `--color-accent` off computed style in the same commit — layout
  // effects run before any passive effect, but two *separate* layout effects on [theme] and
  // [accentColor] could still commit in either order relative to each other. One effect keyed on
  // both deps removes that ambiguity: `--color-accent` is always final by the time the title-bar
  // effect (a plain useEffect, so it runs after) reads it.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (accentColor) {
      document.documentElement.style.setProperty("--color-accent", accentColor);
    } else {
      document.documentElement.style.removeProperty("--color-accent");
    }
  }, [theme, accentColor]);

  // Interface zoom (docs/ARCH-APPEARANCE.md §2.3): CSS `zoom` on #root, not webFrame.setZoomFactor
  // — no IPC/preload change, same visual result, and the 3D canvas's own ResizeObserver re-fits
  // WebGL to the zoomed container size on its own.
  useLayoutEffect(() => {
    const root = document.getElementById("root");
    if (root) root.style.setProperty("zoom", String(uiZoom));
  }, [uiZoom]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        toggleGraphMode();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleAIPanel();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Tab") {
        e.preventDefault();
        useStore.getState().cycleTab(e.shiftKey ? -1 : 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        useStore.getState().openNewTab();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        // Electron would otherwise close the whole window on Ctrl/Cmd+W.
        e.preventDefault();
        useStore.getState().closeTab(useStore.getState().activeTabId);
      } else if (e.key === "Escape") {
        // Return-to-graph, not a close (see docs/ARCH-TAB-WORKSPACE.md §7). Guarded so this never
        // fires on top of an overlay/panel's own Esc handler in the same keypress:
        // NoteEditor/AIPanel/PluginDrawer close themselves on Esc, and CommandPalette/
        // SettingsModal/VaultSwitcher/NotePicker (all `.overlay-backdrop`) close themselves too —
        // none of them stopPropagation, so this handler must self-gate on the same state instead.
        const s = useStore.getState();
        if (s.activeTabId === "graph") return;
        if (document.querySelector(".overlay-backdrop")) return;
        if (s.aiPanelOpen || s.terminalOpen || s.openNoteId || usePluginStore.getState().drawerOpen) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, [contenteditable=true]")) return;
        e.preventDefault();
        s.activateTab("graph");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleGraphMode, toggleAIPanel, toggleSidebar]);

  // Intercept clicks on external http(s) links in rendered markdown (the AI
  // panel today, any note-body preview later) so they open as a new web tab
  // instead of navigating the whole window away (Electron's default for a
  // bare <a href>) or kicking out to the OS browser. In the plain-browser dev
  // build (no window.vaultAPI) there's no embedded browser to host them, so
  // fall back to a normal new tab.
  useEffect(() => {
    // Electron detection via userAgent (not window.vaultAPI) so the embedded
    // browser works independently of the preload bridge — see browserTypes.ts.
    const isDesktop = /\bElectron\//i.test(navigator.userAgent);
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const anchor = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      if (!anchor.closest(".markdown-body")) return;
      e.preventDefault();
      if (isDesktop) useStore.getState().openBrowser(href);
      else window.open(href, "_blank", "noopener");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!ready) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-[var(--color-muted)]">
        正在打开知识库…
      </div>
    );
  }

  // The 3D graph is the app's main surface (docs/WORKSPACE-3D.md): a
  // vertical icon ribbon anchors the left edge, a collapsible notes
  // explorer sits beside it, and the graph fills the rest at full width —
  // the editor/AI/plugin panels float over it as their own rounded,
  // shadowed cards (.floating-dock) instead of squeezing it into a docked
  // column, the same floating language Graph settings already uses. A
  // status bar closes out the window below the whole workbench row.
  return (
    <div className="h-screen w-screen flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <Ribbon />
        <Sidebar />
        <div className="workbench-main">
          <TabWorkspaceStrip />
          <div className="workbench-content">
            <GraphView3D />
            {activeTab?.kind === "web" && <WebViewport />}
            {activeTab?.kind === "newtab" && <NewTabPage tabId={activeTab.id} />}
            <div className="floating-dock">
              <NoteEditor />
              <AIPanel />
              <TerminalPanel />
              <PluginDrawer />
            </div>
          </div>
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <SettingsModal />
      <VaultSwitcher />
    </div>
  );
}
