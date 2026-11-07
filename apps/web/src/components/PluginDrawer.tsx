import { useEffect, useMemo, useRef } from "react";
import { usePluginStore } from "../plugins/store";
import { usePanelMount } from "../usePanelMount";
import { useStore } from "../store";

/**
 * Floating panel (see App.tsx's .floating-dock) hosting plugin panels. Each registered panel gets a
 * tab; the active one's `render(el)` is called against a plain DOM node
 * owned by this component (SolenAPI's panels are framework-agnostic), and
 * its returned cleanup runs whenever the panel is hidden or swapped out.
 */
export function PluginDrawer() {
  const drawerOpen = usePluginStore((s) => s.drawerOpen);
  const { mounted, visible } = usePanelMount(drawerOpen);
  const toggleDrawer = usePluginStore((s) => s.toggleDrawer);
  const panels = usePluginStore((s) => s.panels);
  const activePanelId = usePluginStore((s) => s.activePanelId);
  const setActivePanel = usePluginStore((s) => s.setActivePanel);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelList = useMemo(() => Object.values(panels), [panels]);
  const active = activePanelId ? panels[activePanelId] : undefined;
  const openSettings = useStore((s) => s.openSettings);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    host.innerHTML = "";
    const cleanup = active.render(host);
    return () => cleanup();
    // `mounted` is required: it flips true a render *after* `drawerOpen` (usePanelMount's own
    // effect sets it), which is when hostRef.current actually exists — without it in the deps,
    // this effect fires once too early (host still null, no-op) and never re-fires once the
    // host div mounts, leaving the panel body permanently empty.
  }, [active, drawerOpen, mounted]);

  if (!mounted) return null;

  return (
    <div className={`floating-panel plugin-panel ${visible ? "panel-open" : "panel-closed"}`}>
      <div className="dock-panel-header">
        {panelList.length > 0 && (
          <span className="shrink-0">插件</span>
        )}
        <div className="plugin-tab-strip">
          {panelList.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePanel(p.id)}
              className={`plugin-tab ${p.id === activePanelId ? "active" : ""}`}
            >
              {p.icon ? `${p.icon} ` : ""}
              {p.title}
            </button>
          ))}
        </div>
        <button
          onClick={toggleDrawer}
          title="关闭"
          className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-base leading-none px-1 shrink-0"
        >
          ×
        </button>
      </div>
      {panelList.length === 0 ? (
        <div className="plugin-panel-empty">
          <p>暂无插件面板，请在设置中启用插件。</p>
          <button className="connection-chip connect" onClick={() => openSettings("plugins")}>
            打开设置
          </button>
        </div>
      ) : (
        <div ref={hostRef} className="flex-1 min-h-0 overflow-auto p-3" />
      )}
    </div>
  );
}
