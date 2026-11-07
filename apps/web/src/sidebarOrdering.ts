export type SidebarOrder = Record<string, string[]>;
export const folderKey = (path: string) => "folder:" + path;
export const noteKey = (id: string) => "note:" + id;
export const parentPath = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export function readSidebarOrder(value: unknown): SidebarOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, rows]) => Array.isArray(rows)).map(([parent, rows]) =>
    [parent, [...new Set((rows as unknown[]).filter((key): key is string => typeof key === "string" && /^(folder|note):.+/.test(key)))]]));
}

/** Keep stored siblings in their chosen order; new items follow in their default order. */
export function orderedSidebarItems<T extends { key: string }>(items: T[], parent: string, order: SidebarOrder): T[] {
  const saved = Array.isArray(order[parent]) ? order[parent] : [];
  const rank = new Map(saved.map((key, i) => [key, i]));
  return [...items].sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
}

export function reorderSidebarItems(keys: string[], moving: string, target: string, after: boolean): string[] {
  if (moving === target || !keys.includes(moving) || !keys.includes(target)) return keys;
  const next = keys.filter(key => key !== moving);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, moving);
  return next;
}

export function renameSidebarFolder(order: SidebarOrder, source: string, destination: string): SidebarOrder {
  const replace = (path: string) => path === source || path.startsWith(source + "/") ? destination + path.slice(source.length) : path;
  return Object.fromEntries(Object.entries(order).map(([parent, rows]) => [replace(parent), rows.map(key => key.startsWith("folder:") ? folderKey(replace(key.slice(7))) : key)]));
}

export function deleteSidebarFolder(order: SidebarOrder, path: string): SidebarOrder {
  const inside = (p: string) => p === path || p.startsWith(path + "/");
  return Object.fromEntries(Object.entries(order).filter(([parent]) => !inside(parent)).map(([parent, rows]) =>
    [parent, rows.filter(key => !key.startsWith("folder:") || !inside(key.slice(7))) ]));
}

export function sidebarLevelKeys(paths: string[], notes: { id: string; folder?: string; updatedAt: string }[], parent: string, order: SidebarOrder): string[] {
  const folders = paths.filter(path => parentPath(path) === parent).sort((a,b) => a.split("/").at(-1)!.localeCompare(b.split("/").at(-1)!, "zh-CN"));
  return orderedSidebarItems([...folders.map(path => ({ key: folderKey(path) })),
    ...notes.filter(n => (n.folder ?? "") === parent).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(n => ({ key: noteKey(n.id) }))], parent, order).map(item => item.key);
}

export function moveSidebarFolder(order: SidebarOrder, source: string, destination: string, sourceKeys: string[], targetKeys: string[]): SidebarOrder {
  const result = renameSidebarFolder(order, source, destination);
  if (parentPath(source) !== parentPath(destination)) {
    return { ...result,
      [parentPath(source)]: sourceKeys.filter(key => key !== folderKey(source)),
      [parentPath(destination)]: [...targetKeys.filter(key => key !== folderKey(source) && key !== folderKey(destination)), folderKey(destination)],
    };
  }
  return result;
}
