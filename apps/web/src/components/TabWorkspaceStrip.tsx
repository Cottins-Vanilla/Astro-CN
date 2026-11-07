import { useEffect, useState } from "react";
import { useStore } from "../store";
import { isDesktop, type BrowserTabState } from "../browserTypes";
import { WebToolbar } from "./WebToolbar";
import { WindowControls } from "./WindowControls";

/**
 * Top-of-workbench tab strip (see docs/ARCH-TAB-WORKSPACE.md) — the permanent "Vista grafo" tab
 * plus any open web/newtab tabs, a "+" button, and a chevron dropdown. Owns the `browserAPI.onEvent`
 * subscription and the local `Record<nativeId, BrowserTabState>` map: native web-tab state
 * (url/loading/canGoBack/canGoForward) is deliberately NOT duplicated onto the store's
 * `WorkspaceTab` — only `title` is mirrored there (via `setTabTitle`), everything else stays here
 * and is handed to `<WebToolbar/>`, rendered as this component's own sibling so both stay under one
 * subscription (see §3, §5).
 */
export function TabWorkspaceStrip() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const activateTab = useStore((s) => s.activateTab);
  const openNewTab = useStore((s) => s.openNewTab);
  const closeTab = useStore((s) => s.closeTab);
  const setTabTitle = useStore((s) => s.setTabTitle);

  const [webStates, setWebStates] = useState<Record<string, BrowserTabState>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  // Subscribe once: the manager pushes created/updated/closed/activated for every native web tab —
  // the single insertion path from browserAPI events into the store (see §3).
  useEffect(() => {
    const api = window.browserAPI;
    if (!api || !isDesktop) return;
    return api.onEvent((event) => {
      if (event.type === "created") {
        setWebStates((prev) => ({ ...prev, [event.tab.id]: event.tab }));
        const s = useStore.getState();
        if (!s.tabs.some((t) => t.id === event.tab.id)) {
          useStore.setState({
            tabs: [...s.tabs, { id: event.tab.id, kind: "web", title: event.tab.title || event.tab.url }],
          });
        }
        s.activateTab(event.tab.id);
      } else if (event.type === "updated") {
        setWebStates((prev) => ({ ...prev, [event.tab.id]: event.tab }));
        setTabTitle(event.tab.id, event.tab.title || event.tab.url);
      } else if (event.type === "closed") {
        setWebStates((prev) => {
          const next = { ...prev };
          delete next[event.id];
          return next;
        });
        // The store's closeTab already removed this id from `tabs` when the user closed it — but
        // browserTabs.ts auto-activates its own last native tab and emits `activated` regardless;
        // the store ignores that (below), so reassert its own choice onto the native active pointer.
        // ponytail: one reconcile line covers the race; simpler than teaching main about the graph tab.
        const s = useStore.getState();
        const active = s.tabs.find((t) => t.id === s.activeTabId);
        if (active?.kind === "web") {
          void window.browserAPI?.setActiveTab(active.id);
          void window.browserAPI?.showActive();
        } else {
          void window.browserAPI?.hideAll();
        }
      }
      // "activated" is ignored for strip state — the store's own activeTabId stays authoritative.
    });
  }, [setTabTitle]);

  const active = tabs.find((t) => t.id === activeTabId);
  const activeState = activeTabId ? webStates[activeTabId] : undefined;

  return (
    <>
      <div className="tab-strip nodrag">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`workspace-tab ${t.id === activeTabId ? "active" : ""}`}
            onClick={() => activateTab(t.id)}
            title={t.title}
          >
            <span className="workspace-tab-title">{t.title}</span>
            {t.kind !== "graph" && (
              <button
                className="workspace-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                aria-label="关闭标签页"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="tab-strip-add" onClick={openNewTab} title="新建标签页" aria-label="新建标签页">
          +
        </button>
        <div className="tab-strip-menu-wrap">
          <button
            className="tab-strip-add"
            onClick={() => setMenuOpen((o) => !o)}
            title="已打开的标签页"
            aria-label="已打开的标签页"
          >
            ⌄
          </button>
          {menuOpen && (
            <div className="tab-strip-menu" onMouseLeave={() => setMenuOpen(false)}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className={`palette-item ${t.id === activeTabId ? "active" : ""}`}
                  onClick={() => {
                    activateTab(t.id);
                    setMenuOpen(false);
                  }}
                >
                  <span>{t.title}</span>
                </button>
              ))}
              <button
                className="palette-item"
                onClick={() => {
                  for (const t of tabs) closeTab(t.id);
                  setMenuOpen(false);
                }}
              >
                <span>全部关闭</span>
              </button>
            </div>
          )}
        </div>
        {/* Right end of the strip, where every OS puts them. `.tab-strip-spacer` is also the
            window's drag region — see index.css. */}
        <div className="tab-strip-spacer" />
        <WindowControls />
      </div>
      {active?.kind === "web" && (
        <WebToolbar
          nativeId={active.id}
          state={activeState}
          onNavigate={(url) => void window.browserAPI?.navigate(active.id, url)}
          onBack={() => void window.browserAPI?.goBack(active.id)}
          onForward={() => void window.browserAPI?.goForward(active.id)}
          onReloadOrStop={() => {
            void (activeState?.loading ? window.browserAPI?.stop(active.id) : window.browserAPI?.reload(active.id));
          }}
          onOpenExternally={() => void window.browserAPI?.openExternally(active.id)}
        />
      )}
    </>
  );
}
