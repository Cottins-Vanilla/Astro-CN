/**
 * Every keyboard shortcut the app binds, for the Settings modal's read-only Hotkeys section
 * (SettingsModal.tsx). Hand-maintained: the bindings themselves live in the `keydown` handlers
 * listed in `where` — App.tsx's global handler plus the two components that own their own — and
 * those branches are too dissimilar to drive from a table (Ctrl+Tab reads `shiftKey`, Escape
 * self-gates on overlay state). `where` is here so a shortcut added there has an obvious pointer
 * back to this list.
 *
 * Deliberately only the *bound* commands: the command palette's other entries have no keybinding,
 * and padding this list with them would make the panel read like a command index it isn't.
 */
export const HOTKEYS: { keys: string; label: string; where: string }[] = [
  { keys: "Ctrl+K", label: "搜索操作与笔记", where: "CommandPalette.tsx" },
  { keys: "Ctrl+B", label: "展开或收起笔记列表", where: "App.tsx" },
  { keys: "Ctrl+G", label: "切换星座排列", where: "App.tsx" },
  { keys: "Ctrl+J", label: "展开或收起智能助手", where: "App.tsx" },
  { keys: "Ctrl+T", label: "新建标签页", where: "App.tsx" },
  { keys: "Ctrl+W", label: "关闭标签页", where: "App.tsx" },
  { keys: "Ctrl+Tab", label: "下一个标签页（按住 Shift 切换到上一个）", where: "App.tsx" },
  { keys: "Ctrl+L", label: "在笔记中插入关联链接", where: "NoteEditor.tsx" },
  { keys: "Esc", label: "关闭面板或返回星图", where: "App.tsx" },
];
