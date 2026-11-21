import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, Folder, FolderOpen, Plus, X } from "lucide-react";
import type { NoteMeta } from "@solen/core";
import { fuzzyMatch, fuzzyScore } from "../fuzzy";
import { folderTree, type FolderNode } from "../noteFolders";
import { sidebarLevelItems } from "../sidebarOrdering";
import { useStore } from "../store";
import { AnimatedDisclosure } from "./AnimatedDisclosure";

interface NotePickerProps {
  title: string;
  onClose: () => void;
  onPick: (note: NoteMeta) => void;
}

export function NotePicker({ title, onClose, onPick }: NotePickerProps) {
  const noteList = useStore(s => s.noteList);
  const noteFolders = useStore(s => s.noteFolders);
  const sidebarOrder = useStore(s => s.sidebarOrder);
  const collapsedFolders = useStore(s => s.collapsedNoteFolders);
  const createNote = useStore(s => s.createNote);
  const [collapsed, setCollapsed] = useState(() => new Set(collapsedFolders));
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && document.activeElement === document.body) {
        previous.focus();
      }
    };
  }, []);

  const term = query.trim();
  const roots = useMemo(
    () => folderTree([...noteFolders, ...noteList.map(note => note.folder ?? "")]),
    [noteFolders, noteList],
  );
  const matches = useMemo(() => {
    if (!term) return [];
    return noteList
      .map(note => {
        const label = note.title || "未命名";
        const path = note.folder ? note.folder + "/" + label : label;
        const score = fuzzyMatch(term, label) ? fuzzyScore(term, label)
          : fuzzyMatch(term, path) ? 2000 + fuzzyScore(term, path) : Infinity;
        return { note, score };
      })
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score)
      .map(item => item.note);
  }, [noteList, term]);

  const showCreate = Boolean(term) && !noteList.some(note => note.title.toLowerCase() === term.toLowerCase());
  const lastIndex = matches.length - 1 + Number(showCreate);
  const selectedIndex = Math.min(activeIndex, lastIndex);

  function pick(note: NoteMeta) {
    try {
      onPick(note);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法关联这篇笔记。");
    }
  }

  async function createAndPick() {
    if (!showCreate || busy) return;
    if (/[#|\]]/.test(term)) {
      setError("要新建并关联的笔记标题不能包含 #、| 或 ]。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      pick(await createNote(term));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "新建笔记失败。");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? [])]
      .filter(el => !el.closest('[aria-hidden="true"]'));
    if (event.key === "Tab") {
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && event.target === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    const editingQuery = event.target === inputRef.current;
    if (editingQuery && term && event.key === "Enter") {
      event.preventDefault();
      const note = matches[selectedIndex];
      if (note) pick(note);
      else if (showCreate && selectedIndex === matches.length) void createAndPick();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const rows = controls.filter(el => el.hasAttribute("data-picker-row"));
    event.preventDefault();
    if (editingQuery && term) {
      const next = Math.max(0, Math.min(lastIndex, selectedIndex + direction));
      setActiveIndex(next);
      rows[next]?.scrollIntoView({ block: "nearest" });
    } else if (editingQuery) {
      (direction > 0 ? rows[0] : rows.at(-1))?.focus();
    } else {
      const index = rows.findIndex(el => el === event.target);
      if (index >= 0) (rows[index + direction] ?? inputRef.current)?.focus();
    }
  }

  function noteRow(note: NoteMeta, index?: number) {
    const label = note.title || "未命名";
    return (
      <li key={note.id} className="sidebar-note-item">
        <div className={"sidebar-note-row" + (index === selectedIndex ? " active" : "")}>
          <button type="button" className="sidebar-note-open" data-picker-row title={label}
            disabled={busy} onMouseEnter={index === undefined ? undefined : () => setActiveIndex(index)}
            onClick={() => pick(note)}>
            <FileText size={16} aria-hidden="true" />
            <span>
              <span className="sidebar-note-title">{label}</span>
              {index !== undefined && <small>{note.folder || "最外层"}</small>}
            </span>
          </button>
        </div>
      </li>
    );
  }

  function renderLevel(folders: FolderNode[], parent: string): ReactNode {
    const entries = sidebarLevelItems(folders, noteList, parent, sidebarOrder);
    if (!entries.length) return <li className="sidebar-empty">{parent ? "此文件夹没有笔记" : "还没有笔记"}</li>;
    return entries.map(entry => {
      if ("note" in entry) return noteRow(entry.note);
      const folder = entry.folder;
      const expanded = !collapsed.has(folder.path);
      const Icon = expanded ? FolderOpen : Folder;
      return (
        <li key={entry.key}>
          <div className="sidebar-folder-row">
            <button type="button" className="sidebar-folder" data-picker-row title={folder.path}
              aria-expanded={expanded} onClick={() => setCollapsed(previous => {
                const next = new Set(previous);
                if (next.has(folder.path)) next.delete(folder.path);
                else next.add(folder.path);
                return next;
              })}>
              <Icon size={18} aria-hidden="true" />
              <span>{folder.name}</span>
            </button>
          </div>
          <AnimatedDisclosure open={expanded}>
            <ul className="sidebar-folder-children">{renderLevel(folder.children, folder.path)}</ul>
          </AnimatedDisclosure>
        </li>
      );
    });
  }

  return createPortal(
    <div className="overlay-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="palette-panel note-picker" ref={panelRef} role="dialog" aria-modal="true"
        aria-label={title} aria-busy={busy} onKeyDown={onKeyDown}>
        <div className="note-picker-header">
          <h2>{title}</h2>
          <button type="button" className="note-picker-close" aria-label="关闭关联窗口" disabled={busy} onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="note-picker-search">
          <input ref={inputRef} className="sidebar-search-input" aria-label="搜索要关联的笔记"
            placeholder="搜索笔记名称或文件夹…" value={query} disabled={busy} onChange={event => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setError("");
            }} />
        </div>
        {error && <p role="alert" className="sidebar-error note-picker-error">{error}</p>}
        <div className="note-picker-scroll">
          {term ? (
            <ul>
              {matches.map((note, index) => noteRow(note, index))}
              {matches.length === 0 && <li className="sidebar-empty">没有找到相关笔记</li>}
              {showCreate && (
                <li>
                  <div className={"sidebar-note-row" + (matches.length === selectedIndex ? " active" : "")}>
                    <button type="button" className="sidebar-note-open" data-picker-row disabled={busy}
                      onMouseEnter={() => setActiveIndex(matches.length)} onClick={() => void createAndPick()}>
                      <Plus size={16} aria-hidden="true" />
                      <span className="sidebar-note-title">新建“{term}”</span>
                    </button>
                  </div>
                </li>
              )}
            </ul>
          ) : <ul className="sidebar-folder-list">{renderLevel(roots, "")}</ul>}
        </div>
      </div>
    </div>,
    document.getElementById("root") ?? document.body,
  );
}
