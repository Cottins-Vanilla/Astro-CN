import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { usePanelMount } from "../usePanelMount";
import { fuzzyMatch, fuzzyScore } from "../fuzzy";
import { usePluginStore } from "../plugins/store";
import { pickVaultArchiveFile } from "../vaultArchive";
import { setActivePatterns } from "../graph3d/layouts/constellation";

interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Ctrl+K (Cmd+K on Mac) command palette: a fuzzy list of actions plus, live,
 * every note title so "open X" is one keystroke away. Owns its own
 * open/closed state and global shortcut, same pattern as NoteEditor's
 * Escape handler.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { mounted, visible } = usePanelMount(open);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pluginCommands = usePluginStore((s) => s.commands);
  const togglePluginDrawer = usePluginStore((s) => s.toggleDrawer);
  const noteList = useStore((s) => s.noteList);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const toggleGraphMode = useStore((s) => s.toggleGraphMode);
  const graphDimension = useStore((s) => s.graphDimension);
  const setGraphDimension = useStore((s) => s.setGraphDimension);
  const graphAnimating = useStore((s) => s.graphAnimating);
  const toggleGraphAnimating = useStore((s) => s.toggleGraphAnimating);
  const graphPanelOpen = useStore((s) => s.graphPanelOpen);
  const toggleGraphPanel = useStore((s) => s.toggleGraphPanel);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const createNote = useStore((s) => s.createNote);
  const openNote = useStore((s) => s.openNote);
  const exportVault = useStore((s) => s.exportVault);
  const importVaultFile = useStore((s) => s.importVaultFile);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleImportVault = useCallback(async () => {
    const file = await pickVaultArchiveFile();
    if (!file) return;
    if (
      !window.confirm(
        "导入这个知识库备份？备份中编号相同的笔记和星图会覆盖" +
          "当前内容，其他笔记和星图将会保留。",
      )
    ) {
      return;
    }
    try {
      const { noteCount, canvasCount } = await importVaultFile(file);
      window.alert(`已导入 ${noteCount} 篇笔记和 ${canvasCount} 张星图。`);
    } catch (err) {
      window.alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [importVaultFile]);

  const handleRefreshConstellations = useCallback(async () => {
    try {
      const patterns = await window.constellationsAPI?.download();
      if (!patterns) return;
      setActivePatterns(patterns);
      window.alert(`已下载 ${patterns.length} 个星座图案。`);
    } catch (err) {
      window.alert(`下载失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const actions = useMemo((): Action[] => {
    const list: Action[] = [
      { id: "new-note", label: "新建笔记", run: () => void createNote().then((n) => openNote(n.id)) },
      { id: "constellation", label: "切换星座排列", hint: "Ctrl+G", run: toggleGraphMode },
      {
        id: "graph-dimension",
        label: graphDimension === "3d" ? "切换为平面星图" : "切换为立体星图",
        run: () => setGraphDimension(graphDimension === "3d" ? "2d" : "3d"),
      },
      {
        id: "graph-animating",
        label: "开启或暂停星图动画",
        hint: graphAnimating ? "on" : "off",
        run: toggleGraphAnimating,
      },
      {
        id: "graph-settings",
        label: "星图设置",
        hint: graphPanelOpen ? "close" : "open",
        run: toggleGraphPanel,
      },
      { id: "toggle-sidebar", label: "展开或收起笔记列表", hint: "Ctrl+B", run: toggleSidebar },
      // The ribbon no longer carries a plugin-drawer button (see Ribbon.tsx) — this is how the
      // drawer is opened now.
      { id: "plugin-panels", label: "插件面板", run: togglePluginDrawer },
      { id: "export-vault", label: "导出知识库备份", run: () => void exportVault() },
      { id: "import-vault", label: "导入知识库备份", run: () => void handleImportVault() },
      {
        id: "theme-dark",
        label: "切换为深色界面",
        hint: theme === "dark" ? "current" : undefined,
        run: () => setTheme("dark"),
      },
      {
        id: "theme-light",
        label: "切换为浅色界面",
        hint: theme === "light" ? "current" : undefined,
        run: () => setTheme("light"),
      },
    ];
    if (window.constellationsAPI) {
      list.push({
        id: "refresh-constellations",
        label: "更新星座图案",
        run: () => void handleRefreshConstellations(),
      });
    }
    for (const cmd of Object.values(pluginCommands)) {
      list.push({ id: `plugin:${cmd.id}`, label: cmd.name, run: () => { cmd.run(); } });
    }
    for (const n of noteList) {
      list.push({
        id: `note:${n.id}`,
        label: `打开笔记：${n.title || "未命名"}`,
        run: () => void openNote(n.id),
      });
    }
    return list;
  }, [
    pluginCommands,
    noteList,
    theme,
    toggleGraphMode,
    graphDimension,
    setGraphDimension,
    graphAnimating,
    toggleGraphAnimating,
    graphPanelOpen,
    toggleGraphPanel,
    toggleSidebar,
    togglePluginDrawer,
    setTheme,
    createNote,
    openNote,
    exportVault,
    handleImportVault,
    handleRefreshConstellations,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return actions
      .filter((a) => fuzzyMatch(q, a.label))
      .sort((a, b) => fuzzyScore(q, a.label) - fuzzyScore(q, b.label))
      .slice(0, 40);
  }, [actions, query]);

  function run(action: Action) {
    action.run();
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) run(filtered[activeIndex]);
    }
  }

  if (!mounted) return null;

  return (
    <div className={`overlay-backdrop ${visible ? "panel-open" : "panel-closed"}`} onMouseDown={close}>
      <div className="palette-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="搜索操作或笔记…"
          className="palette-input"
        />
        <ul className="palette-list">
          {filtered.map((a, i) => (
            <li key={a.id}>
              <button
                className={`palette-item ${i === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => run(a)}
              >
                <span>{a.label}</span>
                {a.hint && <span className="palette-hint">{a.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="palette-empty">没有找到匹配项</li>}
        </ul>
      </div>
    </div>
  );
}
