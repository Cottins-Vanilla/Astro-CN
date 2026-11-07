import { useStore } from "../store";
import { resolveEngine } from "../searchEngines";

/**
 * Blank new-tab page — Obsidian's four quick actions (see docs/ARCH-TAB-WORKSPACE.md §4), plain
 * React over `.workbench-content`, no native view. Rendered only while this tab is the active one.
 */
export function NewTabPage(props: { tabId: string }) {
  const createNote = useStore((s) => s.createNote);
  const openNote = useStore((s) => s.openNote);
  const closeTab = useStore((s) => s.closeTab);
  const openBrowser = useStore((s) => s.openBrowser);
  const engine = resolveEngine(
    useStore((s) => s.searchEngine),
    useStore((s) => s.customSearchUrl),
  );

  return (
    <div className="newtab-page">
      <button
        className="newtab-action"
        onClick={() => {
          void createNote().then((n) => openNote(n.id));
          closeTab(props.tabId);
        }}
      >
        新建笔记
      </button>
      <button
        className="newtab-action"
        onClick={() => {
          // Reuses the command palette's own Ctrl+K shortcut instead of lifting its open-state
          // into the store. // ponytail: one dispatched event beats a second source of truth.
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
          closeTab(props.tabId);
        }}
      >
        查找并打开笔记（Ctrl+K）
      </button>
      <button
        className="newtab-action"
        onClick={() => {
          closeTab(props.tabId);
          openBrowser(engine.home);
        }}
      >
        打开内置浏览器
      </button>
      <button className="newtab-action" onClick={() => closeTab(props.tabId)}>
        关闭
      </button>
    </div>
  );
}
