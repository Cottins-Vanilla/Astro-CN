import { folderKey, noteKey, parentPath, sidebarLevelKeys, orderedSidebarItems, reorderSidebarItems } from "../sidebarOrdering";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { NoteMeta } from "@solen/core";
import { useStore, vault } from "../store";
import { canonicalFolderPath, folderPath, folderTree, allFolderPaths, isInsideFolder, type FolderNode } from "../noteFolders";
import { SidebarDialog } from "./SidebarDialog";

interface BodyMatch { id: string; title: string; snippet: string; matchStart: number; matchEnd: number }
type Menu = { type: "folder"; path: string } | { type: "note"; id: string };
type Dialog = { kind: "rename-folder" | "create-child" | "delete-folder" | "move-folder"; path: string }
  | { kind: "rename-note" | "delete-note"; id: string };

export function Sidebar() {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const noteList = useStore(s => s.noteList);
  const openNoteId = useStore(s => s.openNoteId);
  const openNote = useStore(s => s.openNote);
  const createNote = useStore(s => s.createNote);
  const deleteNote = useStore(s => s.deleteNote);
  const renameNote = useStore(s => s.renameNote);
  const moveNoteFolder = useStore(s => s.moveNoteFolder);
  const renameNoteFolder = useStore(s => s.renameNoteFolder);
  const deleteNoteFolder = useStore(s => s.deleteNoteFolder);
  const moveNote = useStore(s => s.moveNote);
  const sidebarOrder = useStore(s => s.sidebarOrder);
  const setSidebarOrder = useStore(s => s.setSidebarOrder);
  const noteFolders = useStore(s => s.noteFolders);
  const setNoteFolders = useStore(s => s.setNoteFolders);
  const [query, setQuery] = useState("");
  const [bodyMatches, setBodyMatches] = useState<BodyMatch[]>([]);
  const [activeFolder, setActiveFolder] = useState("");
  const collapsedPaths = useStore(s => s.collapsedNoteFolders);
  const collapsed = useMemo(() => new Set(collapsedPaths), [collapsedPaths]);
  function setCollapsed(update: (previous: Set<string>) => Set<string>) {
    const state = useStore.getState();
    state.setCollapsedNoteFolders([...update(new Set(state.collapsedNoteFolders))]);
  }
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [folderMoveTarget, setFolderMoveTarget] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [deleteContents, setDeleteContents] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dragSource = useRef<{ key: string; parent: string } | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ key: string; position: "before" | "after" | "inside" } | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const tree = useMemo(() => folderTree([...noteFolders, ...noteList.map(n => n.folder ?? "")]), [noteFolders, noteList]);
  const paths = useMemo(() => allFolderPaths(tree), [tree]);
  const notes = useMemo(() => [...noteList].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), [noteList]);
  const filtered = notes.filter(n => n.title.toLowerCase().includes(query.trim().toLowerCase()));
  type Entry = { key: string; folder: FolderNode } | { key: string; note: NoteMeta };
  function levelItems(nodes: FolderNode[], parent: string): Entry[] {
    return orderedSidebarItems<Entry>([...nodes.map(folder => ({ key: folderKey(folder.path), folder })),
      ...notes.filter(n => (n.folder ?? "") === parent).map(note => ({ key: noteKey(note.id), note }))], parent, sidebarOrder);
  }
  function siblings(parent: string): Entry[] {
    const find = (nodes: FolderNode[]): FolderNode | undefined => { for (const node of nodes) { if (node.path === parent) return node; const found = find(node.children); if (found) return found; } };
    return levelItems(parent ? find(tree)?.children ?? [] : tree, parent);
  }
  function reorder(parent: string, moving: string, target: string, after: boolean) {
    const keys = siblings(parent).map(item => item.key);
    const next = reorderSidebarItems(keys, moving, target, after);
    if (next !== keys) setSidebarOrder({ ...useStore.getState().sidebarOrder, [parent]: next });
  }
  function shift(key: string, parent: string, offset: number) {
    const items = siblings(parent); const index = items.findIndex(item => item.key === key);
    const target = items[index + offset];
    if (target) reorder(parent, key, target.key, offset > 0);
    setMenu(null);
  }
  function canShift(key: string, parent: string, offset: number) {
    if (query.trim()) return false;
    const items = siblings(parent); return !!items[items.findIndex(item => item.key === key) + offset];
  }
  function clearDrag() { dragSource.current = null; setDraggingKey(null); setDropHint(null); setDropPath(null); }
  function rowDragProps(key: string, parent: string, folder?: string) {
    function position(e: React.DragEvent): "before" | "after" | "inside" | null {
      const source = dragSource.current;
      if (!source || source.key === key || busy || query.trim()) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
      const inside = !!folder && ratio > .28 && ratio < .72;
      const destination = inside ? folder! : parent;
      if (source.key.startsWith("folder:") && isInsideFolder(destination, source.key.slice(7))) return null;
      return inside ? "inside" : ratio < .5 ? "before" : "after";
    }
    return {
      draggable: !busy && !query.trim(),
      "data-sidebar-key": key, "data-sidebar-parent": parent,
      "data-drop-position": dropHint?.key === key ? dropHint.position : undefined,
      "data-dragging": draggingKey === key || undefined,
      onDragStart(e: React.DragEvent) {
        e.stopPropagation(); dragSource.current = { key, parent }; setDraggingKey(key); setMenu(null);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-astro-sidebar", key);
        if (key.startsWith("note:")) e.dataTransfer.setData("application/x-astro-note", key.slice(5));
      },
      onDragEnd: clearDrag,
      onDragOver(e: React.DragEvent) {
        const pos = position(e); if (!pos) { setDropHint(null); return; }
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move";
        setDropHint({ key, position: pos }); setDropPath(pos === "inside" ? folder! : null);
      },
      onDragLeave(e: React.DragEvent) {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) { setDropHint(null); setDropPath(null); }
      },
      onDrop(e: React.DragEvent) {
        const pos = position(e); const source = dragSource.current;
        e.preventDefault(); e.stopPropagation();
        if (pos && source) {
          if (pos === "inside" && folder) void handleRelocate(source.key, folder);
          else if (source.parent === parent) reorder(parent, source.key, key, pos === "after");
          else void handleRelocate(source.key, parent, key, pos === "after");
        }
        clearDrag();
      },
    };
  }
  function renderLevel(nodes: FolderNode[], parent: string): React.ReactNode {
    return levelItems(nodes, parent).map(item => "folder" in item ? folderRow(item.folder) : noteRow(item.note));
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setBodyMatches([]); return; }
    const lower = q.toLowerCase();
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const results = await Promise.allSettled(noteList.map(n => vault.readNote(n.id)));
        if (cancelled || queryRef.current.trim().toLowerCase() !== lower) return;
        const matches: BodyMatch[] = [];
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const note = result.value;
          const line = note.body.split("\n").find(l => l.toLowerCase().includes(lower))?.trim();
          if (line === undefined) continue;
          const matchStart = line.toLowerCase().indexOf(lower);
          matches.push({ id: note.id, title: note.title, snippet: line, matchStart, matchEnd: matchStart + lower.length });
        }
        setBodyMatches(matches);
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, noteList]);

  useEffect(() => {
    if (!menu) return;
    function closeOnOutside(e: MouseEvent) {
      if (!(e.target instanceof Element) || !e.target.closest("[data-sidebar-menu]")) setMenu(null);
    }
    function closeOnEscape(e: KeyboardEvent) { if (e.key === "Escape") { e.stopPropagation(); setMenu(null); } }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [menu]);

  function expand(path: string) {
    setCollapsed(prev => new Set([...prev].filter(p => p !== path && !path.startsWith(p + "/"))));
  }
  async function handleCreateNote() {
    if (busy) return;
    setError(""); setBusy(true);
    try {
      const note = await createNote();
      if (activeFolder) await moveNote(note.id, activeFolder);
      expand(activeFolder);
      await openNote(note.id);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setError("");
    try {
      const path = canonicalFolderPath(newFolder, paths);
      if (paths.some(p => p.toLowerCase() === path.toLowerCase())) throw new Error("这个文件夹已经存在。");
      setNoteFolders([...paths, path]);
      setActiveFolder(path); expand(path);
      setCreatingFolder(false); setNewFolder("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function handleRelocate(key: string, destination: string, targetKey?: string, after = false) {
    if (busy) return;
    setError(""); setBusy(true);
    try {
      let movedKey = key;
      if (key.startsWith("folder:")) {
        const source = key.slice(7);
        const movedPath = await moveNoteFolder(source, destination);
        movedKey = folderKey(movedPath);
        if (isInsideFolder(activeFolder, source)) setActiveFolder(movedPath + activeFolder.slice(source.length));
      } else {
        const id = key.slice(5);
        await moveNote(id, destination || undefined);
        const state = useStore.getState();
        setNoteFolders([...new Set([...state.noteFolders, ...paths, ...(destination ? [destination] : [])])]);
        if (openNoteId === id) setActiveFolder(destination);
      }
      if (targetKey) {
        const state = useStore.getState();
        const currentPaths = allFolderPaths(folderTree([...state.noteFolders, ...state.noteList.map(n => n.folder ?? "")]));
        const keys = sidebarLevelKeys(currentPaths, state.noteList, destination, state.sidebarOrder);
        setSidebarOrder({ ...state.sidebarOrder, [destination]: reorderSidebarItems(keys, movedKey, targetKey, after) });
      }
      expand(destination); setMovingId(null);
    } catch (e) { setError("移动失败：" + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); setDropPath(null); }
  }
  function handleMove(id: string, destination: string) { return handleRelocate(noteKey(id), destination); }
  function drop(e: React.DragEvent, destination: string) {
    e.preventDefault(); e.stopPropagation();
    const source = dragSource.current;
    if (source) void handleRelocate(source.key, destination);
    clearDrag();
  }
  function toggleFolder(path: string) {
    setActiveFolder(path);
    setCollapsed(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
  }
  function showDialog(next: Dialog) {
    setMenu(null); setMovingId(null); setError(""); setDialogError(""); setDeleteContents(false);
    setName(next.kind === "rename-folder" ? ("path" in next ? next.path.split("/").at(-1)! : "")
      : next.kind === "rename-note" && "id" in next ? noteList.find(n => n.id === next.id)?.title ?? "" : "");
    if (next.kind === "move-folder") setFolderMoveTarget(parentPath(next.path));
    setDialog(next);
  }
  async function submitDialog(e: React.FormEvent) {
    e.preventDefault(); if (!dialog || busy) return;
    setDialogError(""); setBusy(true);
    try {
      if (dialog.kind === "rename-folder" && "path" in dialog) {
        const oldPath = dialog.path;
        const destination = await renameNoteFolder(oldPath, name);
        if (isInsideFolder(activeFolder, oldPath)) setActiveFolder(destination + activeFolder.slice(oldPath.length));
      } else if (dialog.kind === "move-folder" && "path" in dialog) {
        const movedPath = await moveNoteFolder(dialog.path, folderMoveTarget);
        if (isInsideFolder(activeFolder, dialog.path)) setActiveFolder(movedPath + activeFolder.slice(dialog.path.length));
        expand(folderMoveTarget);
      } else if (dialog.kind === "create-child" && "path" in dialog) {
        const childName = folderPath(name);
        if (childName.includes("/")) throw new Error("这里只填写子文件夹名称，不能包含“/”。");
        const path = canonicalFolderPath(dialog.path + "/" + childName, paths);
        if (paths.some(p => p.toLowerCase() === path.toLowerCase())) throw new Error("这个文件夹已经存在。");
        setNoteFolders([...paths, path]); setActiveFolder(path); expand(path);
      } else if (dialog.kind === "delete-folder" && "path" in dialog) {
        await deleteNoteFolder(dialog.path, deleteContents);
        if (isInsideFolder(activeFolder, dialog.path)) setActiveFolder("");
      } else if (dialog.kind === "rename-note" && "id" in dialog) {
        await renameNote(dialog.id, name);
      } else if (dialog.kind === "delete-note" && "id" in dialog) {
        await deleteNote(dialog.id);
      }
      setDialog(null);
    } catch (e) { setDialogError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function noteRow(n: NoteMeta, showFolder = false) {
    const menuOpen = menu?.type === "note" && menu.id === n.id;
    return <li key={noteKey(n.id)} className="sidebar-note-item">
      <div className={"sidebar-note-row " + (openNoteId === n.id ? "active" : "")} {...rowDragProps(noteKey(n.id), n.folder ?? "")}
        onContextMenu={e => { e.preventDefault(); if (!busy) setMenu({ type: "note", id: n.id }); }}
        >
        <button className="sidebar-note-open" title={n.title || "未命名"} onClick={() => { setActiveFolder(n.folder ?? ""); void openNote(n.id); }}>
          <FileText size={16} /><span><span className="sidebar-note-title">{n.title || "未命名"}</span>
          {showFolder && <small>{n.folder || "最外层"}</small>}</span>
        </button>
        <button className="sidebar-note-action sidebar-menu-trigger" data-sidebar-menu title="笔记操作" aria-label={"笔记操作：" + (n.title || "未命名")}
          aria-expanded={menuOpen} disabled={busy} onClick={() => setMenu(menuOpen ? null : { type: "note", id: n.id })}><MoreHorizontal size={15} /></button>
      </div>
      {menuOpen && <div className="sidebar-item-menu" role="group" aria-label="笔记操作菜单" data-sidebar-menu>
        <button disabled={!canShift(noteKey(n.id), n.folder ?? "", -1)} onClick={() => shift(noteKey(n.id), n.folder ?? "", -1)}>↑ 上移</button>
        <button disabled={!canShift(noteKey(n.id), n.folder ?? "", 1)} onClick={() => shift(noteKey(n.id), n.folder ?? "", 1)}>↓ 下移</button>
        <button onClick={() => showDialog({ kind: "rename-note", id: n.id })}><Pencil size={12} />重命名</button>
        <button onClick={() => { setMenu(null); setMovingId(n.id); setMoveTarget(n.folder ?? ""); }}><Folder size={12} />移动到文件夹</button>
        <button className="danger" onClick={() => showDialog({ kind: "delete-note", id: n.id })}><Trash2 size={12} />删除笔记</button>
      </div>}
      {movingId === n.id && <div className="sidebar-move-box">
        <label>移动到<select aria-label="目标文件夹" value={moveTarget} onChange={e => setMoveTarget(e.target.value)} disabled={busy}>
          <option value="">最外层</option>{paths.map(path => <option key={path} value={path}>{path}</option>)}
        </select></label>
        <div><button disabled={busy} onClick={() => void handleMove(n.id, moveTarget)}>移动</button><button disabled={busy} onClick={() => setMovingId(null)}>取消</button></div>
      </div>}
    </li>;
  }
  function folderRow(node: FolderNode): React.ReactNode {
    const count = notes.filter(n => isInsideFolder(n.folder, node.path)).length;
    const closed = collapsed.has(node.path);
    const menuOpen = menu?.type === "folder" && menu.path === node.path;
    return <li key={folderKey(node.path)}>
      <div className="sidebar-folder-row" {...rowDragProps(folderKey(node.path), parentPath(node.path), node.path)} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (!busy) setMenu({ type: "folder", path: node.path }); }}>
        <button className={"sidebar-folder " + (activeFolder === node.path ? "active " : "") + (dropPath === node.path ? "drop-target" : "")}
          title={node.path} aria-expanded={!closed} onClick={() => toggleFolder(node.path)}>
          {closed ? <Folder size={18} className="sidebar-folder-icon" /> : <FolderOpen size={18} className="sidebar-folder-icon" />}<span>{node.name}</span><small>{count}</small>
        </button>
        <button className="sidebar-note-action sidebar-menu-trigger" data-sidebar-menu title="文件夹操作" aria-label={"文件夹操作：" + node.path}
          aria-expanded={menuOpen} disabled={busy} onClick={() => setMenu(menuOpen ? null : { type: "folder", path: node.path })}><MoreHorizontal size={15} /></button>
      </div>
      {menuOpen && <div className="sidebar-item-menu" role="group" aria-label="文件夹操作菜单" data-sidebar-menu>
        <button disabled={!canShift(folderKey(node.path), parentPath(node.path), -1)} onClick={() => shift(folderKey(node.path), parentPath(node.path), -1)}>↑ 上移</button>
        <button disabled={!canShift(folderKey(node.path), parentPath(node.path), 1)} onClick={() => shift(folderKey(node.path), parentPath(node.path), 1)}>↓ 下移</button>
        <button onClick={() => showDialog({ kind: "move-folder", path: node.path })}><Folder size={12} />移动到文件夹</button>
        {parentPath(node.path) && <button onClick={() => { setMenu(null); void handleRelocate(folderKey(node.path), parentPath(parentPath(node.path))); }}>移到上一层</button>}
        <button onClick={() => showDialog({ kind: "rename-folder", path: node.path })}><Pencil size={12} />重命名</button>
        <button onClick={() => showDialog({ kind: "create-child", path: node.path })}><FolderPlus size={12} />新建子文件夹</button>
        <button className="danger" onClick={() => showDialog({ kind: "delete-folder", path: node.path })}><Trash2 size={12} />删除文件夹</button>
      </div>}
      <AnimatedDisclosure open={!closed}><ul className="sidebar-folder-children">
        {renderLevel(node.children, node.path)}
        {!node.children.length && !notes.some(n => n.folder === node.path) && <li className="sidebar-empty">拖入文件夹、笔记，或点 + 新建</li>}
      </ul></AnimatedDisclosure>
    </li>;
  }

  const deletingFolder = dialog?.kind === "delete-folder";
  const deletingNote = dialog?.kind === "delete-note";
  const affectedCount = dialog && "path" in dialog ? notes.filter(n => isInsideFolder(n.folder, dialog.path)).length : 0;
  const selectedNote = dialog && "id" in dialog ? notes.find(n => n.id === dialog.id) : undefined;
  const dialogTitle = dialog?.kind === "rename-folder" ? "重命名文件夹" : dialog?.kind === "rename-note" ? "重命名笔记"
    : dialog?.kind === "move-folder" ? "移动文件夹" : dialog?.kind === "create-child" ? "新建子文件夹" : deletingFolder ? "删除文件夹" : "删除笔记";

  return <aside className={"sidebar w-60 flex flex-col " + (sidebarOpen ? "" : "collapsed")}>
    <div className="flex-1 overflow-y-auto px-2 py-3 min-h-0">
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-xs font-semibold">笔记 · {noteList.length}</span>
        <div className="sidebar-header-actions">
          <button title="新建文件夹" aria-label="新建文件夹" disabled={busy} onClick={() => { setCreatingFolder(!creatingFolder); setError(""); }}><FolderPlus size={16} /></button>
          <button title={activeFolder ? "在“" + activeFolder + "”中新建笔记" : "新建笔记"} aria-label="新建笔记" disabled={busy} onClick={() => void handleCreateNote()}>+</button>
        </div>
      </div>
      {creatingFolder && <form className="sidebar-folder-form" onSubmit={handleCreateFolder}>
        <input autoFocus aria-label="文件夹名称" placeholder="名称，例如：项目/Java" value={newFolder} onChange={e => setNewFolder(e.target.value)} disabled={busy} />
        <div><button type="submit" disabled={busy}>创建</button><button type="button" disabled={busy} onClick={() => setCreatingFolder(false)}>取消</button></div>
      </form>}
      {error && <p role="alert" className="sidebar-error">{error}</p>}
      <input value={query} onChange={e => { setQuery(e.target.value); setMenu(null); }} placeholder="搜索笔记…"
        className="w-full mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]" />
      {query.trim() ? <ul>{filtered.map(n => noteRow(n, true))}{!filtered.length && !bodyMatches.length && <li className="sidebar-empty">没有找到相关内容</li>}</ul> : <>
        <ul className="sidebar-folder-list">{renderLevel(tree, "")}</ul>
        <button className={"sidebar-folder sidebar-root " + (activeFolder === "" ? "active " : "") + (dropPath === "" ? "drop-target" : "")}
          title="拖入文件夹或笔记可移到最外层" onClick={() => setActiveFolder("")} onDragOver={e => { if (!busy && dragSource.current && e.dataTransfer.types.includes("application/x-astro-sidebar")) { e.preventDefault(); setDropPath(""); } }}
          onDragLeave={() => setDropPath(null)} onDrop={e => drop(e, "")}>
          <FileText size={14} /><span>最外层</span>
        </button>

      </>}
      {bodyMatches.length > 0 && <>
        <div className="search-group-label px-2 mt-3 mb-1">正文中的搜索结果</div>
        <ul>{bodyMatches.map(m => <li key={m.id}><button className="sidebar-search-match" onClick={() => void openNote(m.id)}>
          <div className="truncate">{m.title || "未命名"}</div><div className="search-snippet">{m.snippet.slice(0,m.matchStart)}<mark>{m.snippet.slice(m.matchStart,m.matchEnd)}</mark>{m.snippet.slice(m.matchEnd)}</div>
        </button></li>)}</ul>
      </>}
    </div>
    {dialog && <SidebarDialog title={dialogTitle} busy={busy} error={dialogError} onCancel={() => setDialog(null)} onSubmit={submitDialog}
      danger={!!(deletingFolder || deletingNote)} confirmLabel={deletingNote ? "删除笔记" : deletingFolder ? deleteContents && affectedCount ? "删除文件夹和笔记" : "删除文件夹" : dialog.kind === "move-folder" ? "移动" : dialog.kind === "create-child" ? "创建" : "保存"}>
      {dialog.kind === "move-folder" && "path" in dialog ? <>
        <p>移动“{dialog.path}”</p>
        <p className="sidebar-dialog-hint">里面的子文件夹和 {affectedCount} 篇笔记会一起移动。</p>
        <label className="sidebar-name-label">移动到
          <select autoFocus aria-label="文件夹移动目标" value={folderMoveTarget} onChange={e => setFolderMoveTarget(e.target.value)} disabled={busy}>
            <option value="">最外层</option>
            {paths.filter(p => !isInsideFolder(p, dialog.path)).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </> : deletingFolder && "path" in dialog ? <>
        <p>确定删除“{dialog.path}”及其子文件夹？</p>
        {affectedCount > 0 ? <>
          <p className="sidebar-dialog-hint">里面共 {affectedCount} 篇笔记。默认将它们移到“最外层”，保留全部内容。</p>
          <label className="sidebar-delete-checkbox"><input type="checkbox" checked={deleteContents} disabled={busy} onChange={e => setDeleteContents(e.target.checked)} />同时删除这 {affectedCount} 篇笔记（无法恢复）</label>
        </> : <p className="sidebar-dialog-hint">这个文件夹里没有笔记。</p>}
      </> : deletingNote ? <>
        <p>确定删除笔记“{selectedNote?.title || "未命名"}”？</p><p className="sidebar-dialog-hint">删除后无法恢复。</p>
      </> : <>
        {dialog.kind === "create-child" && "path" in dialog && <p className="sidebar-dialog-hint">创建位置：{dialog.path}</p>}
        <label className="sidebar-name-label">{dialog.kind === "rename-note" ? "笔记名称" : "文件夹名称"}
          <input autoFocus aria-label="新名称" value={name} disabled={busy} onFocus={e => e.target.select()} onChange={e => setName(e.target.value)} placeholder="请输入名称" />
        </label>
      </>}
    </SidebarDialog>}
  </aside>;
}


