export function folderPath(input: string): string {
  const parts = input.trim().split("/").map(s => s.trim());
  if (parts.some(s => !s || s === "." || s === ".." || /[<>:"\\|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) {
    throw new Error("文件夹名称不能包含特殊符号或空白层级。可用“项目/Java”创建多级分类。");
  }
  return parts.join("/");
}
export interface FolderNode { path: string; name: string; children: FolderNode[] }
export function folderTree(paths: string[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const path of paths.filter(Boolean)) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join("/");
      if (!nodes.has(prefix)) nodes.set(prefix, { path: prefix, name: parts[i], children: [] });
    }
  }
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.path.includes("/") ? nodes.get(node.path.slice(0, node.path.lastIndexOf("/"))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (rows: FolderNode[]) => { rows.sort((a,b) => a.name.localeCompare(b.name, "zh-CN")); rows.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}
export function allFolderPaths(nodes: FolderNode[]): string[] {
  return nodes.flatMap(node => [node.path, ...allFolderPaths(node.children)]);
}

export function canonicalFolderPath(input: string, paths: string[]): string {
  return folderPath(input).split("/").reduce((parent, part) => {
    const candidate = parent ? parent + "/" + part : part;
    return paths.find(path => path.toLowerCase() === candidate.toLowerCase()) ?? candidate;
  }, "");
}

export function isInsideFolder(folder: string | undefined, parent: string): boolean {
  return folder === parent || !!folder?.startsWith(parent + "/");
}

export interface FolderMove { id: string; from: string | undefined; to: string | undefined }

export function renameFolderPlan(source: string, name: string, paths: string[], notes: { id: string; folder?: string }[]) {
  const cleanName = folderPath(name);
  if (cleanName.includes("/")) throw new Error("这里只填写文件夹名称，不能包含“/”。");
  const parent = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
  const destination = parent ? parent + "/" + cleanName : cleanName;
  if (destination.toLowerCase() === source.toLowerCase()) throw new Error("请填写与原来不同的名称。");
  if (paths.some(p => !isInsideFolder(p, source) &&
    (p.toLowerCase() === destination.toLowerCase() || p.toLowerCase().startsWith(destination.toLowerCase() + "/")))) {
    throw new Error("同一位置已有这个名称的文件夹，请换一个名称。");
  }
  const replace = (p: string) => isInsideFolder(p, source) ? destination + p.slice(source.length) : p;
  return {
    destination,
    folders: [...new Set(paths.map(replace))],
    moves: notes.filter(n => isInsideFolder(n.folder, source)).map(n => ({ id: n.id, from: n.folder, to: replace(n.folder!) })),
  };
}

/** Restore completed moves if a later move fails. No folder metadata changes until every move succeeds. */
export async function applyFolderMoves(moves: FolderMove[], move: (id: string, folder: string | undefined) => Promise<void>): Promise<void> {
  const completed: FolderMove[] = [];
  try {
    for (const item of moves) { await move(item.id, item.to); completed.push(item); }
  } catch (error) {
    let rollbackFailed = false;
    for (const item of completed.reverse()) {
      try { await move(item.id, item.from); } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new Error("操作未完成，部分笔记未能移回原处。笔记仍在，左侧会显示当前位置，请检查后重试。");
    throw error;
  }
}


/** Relocate an entire folder tree without merging with another folder of the same name. */
export function moveFolderPlan(source: string, targetParent: string, paths: string[], notes: { id: string; folder?: string }[]) {
  source = folderPath(source);
  if (!paths.includes(source)) throw new Error("这个文件夹已不存在。");
  const parent = targetParent ? canonicalFolderPath(targetParent, paths) : "";
  if (parent && !paths.includes(parent)) throw new Error("目标文件夹已不存在，请重新选择。");
  if (parent && isInsideFolder(parent.toLowerCase(), source.toLowerCase())) throw new Error("不能将文件夹移入它自己或它的子文件夹。");
  const destination = parent ? parent + "/" + source.split("/").at(-1)! : source.split("/").at(-1)!;
  if (destination === source) return { destination, folders: paths, moves: [] as FolderMove[] };
  if (paths.some(path => !isInsideFolder(path, source) &&
    (path.toLowerCase() === destination.toLowerCase() || path.toLowerCase().startsWith(destination.toLowerCase() + "/")))) {
    throw new Error("目标位置已有同名文件夹，请先重命名后再移动。");
  }
  const replace = (path: string) => isInsideFolder(path, source) ? destination + path.slice(source.length) : path;
  return { destination, folders: [...new Set(paths.map(replace))],
    moves: notes.filter(n => isInsideFolder(n.folder, source)).map(n => ({ id: n.id, from: n.folder, to: replace(n.folder!) })) };
}
