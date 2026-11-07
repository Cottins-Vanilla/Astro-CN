import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore, vault } from "../store";
import type { Note } from "@solen/core";

const time = "2026-11-03T00:00:00.000Z";
const make = (id: string, folder?: string): Note => ({ id, title: id, folder, body: "正文 " + id, tags: [], createdAt: time, updatedAt: time });
let disk: Map<string, Note>;

beforeEach(() => {
  vi.useFakeTimers();
  const rows = [make("a", "Java"), make("b", "Java/错题"), make("c", "JavaScript")];
  disk = new Map(rows.map(n => [n.id, { ...n }]));
  useStore.setState({ notes: Object.fromEntries(rows.map(n => [n.id, { ...n }])), noteList: rows.map(({ body, ...n }) => n),
    sidebarOrder: {}, collapsedNoteFolders: [], noteFolders: ["Java", "Java/错题/待读", "空文件夹", "JavaScript"], openNoteId: null });
  vi.spyOn(vault, "listNotes").mockImplementation(async () => [...disk.values()].map(({body, ...note}) => note));
  vi.spyOn(vault, "readNote").mockImplementation(async id => {
    const note = disk.get(id); if (!note) throw new Error("不存在"); return { ...note };
  });
  vi.spyOn(vault, "writeNote").mockImplementation(async note => { disk.set(note.id, { ...note }); });
  vi.spyOn(vault, "moveNote").mockImplementation(async (id, folder) => {
    const note = disk.get(id); if (!note) throw new Error("不存在"); disk.set(id, { ...note, folder });
  });
  vi.spyOn(vault, "deleteNote").mockImplementation(async id => { disk.delete(id); });
  vi.spyOn(vault, "listCanvases").mockResolvedValue([]);
});
afterEach(async () => { await vi.runAllTimersAsync(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("分类管理及保存", () => {
  it("改名包括子文件夹和空文件夹，不影响前缀相似的分类", async () => {
    await useStore.getState().renameNoteFolder("Java", "后端");
    expect(disk.get("a")?.folder).toBe("后端");
    expect(disk.get("b")?.folder).toBe("后端/错题");
    expect(disk.get("c")?.folder).toBe("JavaScript");
    expect(useStore.getState().noteFolders).toEqual(expect.arrayContaining(["后端/错题/待读", "空文件夹"]));
    expect(useStore.getState().notes.b.folder).toBe("后端/错题");
  });
  it("嵌套文件夹只修改自身名称", async () => {
    await useStore.getState().renameNoteFolder("Java/错题", "知识点");
    expect(disk.get("b")?.folder).toBe("Java/知识点");
    expect(useStore.getState().noteFolders).toContain("Java/知识点/待读");
    expect(disk.get("a")?.folder).toBe("Java");
  });
  it("拒绝与现有文件夹重名，不移动笔记", async () => {
    await expect(useStore.getState().renameNoteFolder("Java", "javascript")).rejects.toThrow("已有");
    expect(vault.moveNote).not.toHaveBeenCalled();
  });
  it("文件夹改名失败时恢复已经移动的笔记及分类", async () => {
    vi.mocked(vault.moveNote).mockImplementation(async (id, folder) => {
      if (id === "b" && folder === "后端/错题") throw new Error("模拟文件被占用");
      disk.set(id, { ...disk.get(id)!, folder });
    });
    await expect(useStore.getState().renameNoteFolder("Java", "后端")).rejects.toThrow("被占用");
    expect(disk.get("a")?.folder).toBe("Java");
    expect(useStore.getState().notes.a.folder).toBe("Java");
    expect(useStore.getState().noteFolders).toContain("Java/错题/待读");
  });
  it("默认删除文件夹保留全部笔记，移到未分类", async () => {
    await useStore.getState().deleteNoteFolder("Java");
    expect(disk.size).toBe(3);
    expect(disk.get("a")?.folder).toBeUndefined();
    expect(disk.get("b")?.folder).toBeUndefined();
    expect(disk.get("b")?.body).toBe("正文 b");
    expect(useStore.getState().noteFolders).toEqual(expect.arrayContaining(["JavaScript", "空文件夹"]));
  });
  it("删除文件夹移动失败时恢复原分类", async () => {
    vi.mocked(vault.moveNote).mockImplementation(async (id, folder) => {
      if (id === "b" && !folder) throw new Error("文件占用");
      disk.set(id, { ...disk.get(id)!, folder });
    });
    await expect(useStore.getState().deleteNoteFolder("Java")).rejects.toThrow("文件占用");
    expect(disk.get("a")?.folder).toBe("Java");
    expect(useStore.getState().noteFolders).toContain("Java");
  });
  it("明确选择后可以删除文件夹内的笔记及后代笔记", async () => {
    useStore.getState().updateNoteBody("b", "删除前刚写入的内容");
    await useStore.getState().deleteNoteFolder("Java", true);
    await vi.runAllTimersAsync();
    expect([...disk.keys()]).toEqual(["c"]);
    expect(useStore.getState().noteList.map(n => n.id)).toEqual(["c"]);
  });
  it("空文件夹可改名并删除", async () => {
    await useStore.getState().renameNoteFolder("空文件夹", "归档");
    expect(useStore.getState().noteFolders).toContain("归档");
    await useStore.getState().deleteNoteFolder("归档");
    expect(useStore.getState().noteFolders).not.toContain("归档");
    expect(disk.size).toBe(3);
  });
  it("笔记重命名立即保存未落盘的正文", async () => {
    useStore.getState().updateNoteBody("a", "刚写入的代码");
    await useStore.getState().renameNote("a", " 新名称 ");
    await vi.runAllTimersAsync();
    expect(disk.get("a")).toMatchObject({ title: "新名称", body: "刚写入的代码", folder: "Java" });
    expect(useStore.getState().noteList.find(n => n.id === "a")?.title).toBe("新名称");
  });
  it("笔记删除会等待正在保存的内容，之后不会复活", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(vault.writeNote).mockImplementationOnce(note => new Promise<void>(resolve => {
      finish = () => { disk.set(note.id, { ...note }); resolve(); };
    }));
    useStore.getState().updateNoteBody("a", "正在保存");
    await vi.advanceTimersByTimeAsync(2000);
    expect(finish).toBeTypeOf("function");
    const deletion = useStore.getState().deleteNote("a");
    useStore.getState().updateNoteBody("a", "删除中的输入");
    finish!(); await deletion;
    await vi.runAllTimersAsync();
    expect(disk.has("a")).toBe(false);
    expect(useStore.getState().notes.a).toBeUndefined();
  });
});



describe("文件夹跨层级移动",()=>{
 it("整个文件夹连同笔记、子目录与空目录移入目标",async()=>{
  await useStore.getState().moveNoteFolder("Java","空文件夹");
  expect(disk.get("a")).toMatchObject({folder:"空文件夹/Java",body:"正文 a"});
  expect(disk.get("b")).toMatchObject({folder:"空文件夹/Java/错题",body:"正文 b"});
  expect(disk.get("c")?.folder).toBe("JavaScript");
  expect(useStore.getState().noteFolders).toContain("空文件夹/Java/错题/待读");
  expect(useStore.getState().noteFolders).not.toContain("Java");
 });
 it("子目录连同文件移到最外层，原父目录保留",async()=>{
  await useStore.getState().moveNoteFolder("Java/错题","");
  expect(disk.get("b")?.folder).toBe("错题");
  expect(disk.get("a")?.folder).toBe("Java");
  expect(useStore.getState().noteFolders).toEqual(expect.arrayContaining(["Java","错题/待读"]));
 });
 it("空文件夹也可以移动",async()=>{
  await useStore.getState().moveNoteFolder("空文件夹","Java");
  expect(useStore.getState().noteFolders).toContain("Java/空文件夹");
  expect(vault.moveNote).not.toHaveBeenCalled();
 });
 it("内部排列和收起状态随路径一起更新",async()=>{
  useStore.setState({sidebarOrder:{"":["folder:Java","folder:空文件夹","folder:JavaScript"],Java:["folder:Java/错题","note:a"],"Java/错题":["note:b","folder:Java/错题/待读"],空文件夹:[]},collapsedNoteFolders:["Java/错题"]});
  await useStore.getState().moveNoteFolder("Java","空文件夹");
  expect(useStore.getState().sidebarOrder["空文件夹/Java"]).toEqual(["folder:空文件夹/Java/错题","note:a"]);
  expect(useStore.getState().sidebarOrder["空文件夹/Java/错题"]).toEqual(["note:b","folder:空文件夹/Java/错题/待读"]);
  expect(useStore.getState().sidebarOrder[""]).not.toContain("folder:Java");
  expect(useStore.getState().sidebarOrder.空文件夹).toContain("folder:空文件夹/Java");
  expect(useStore.getState().collapsedNoteFolders).toEqual(["空文件夹/Java/错题"]);
 });
 it.each(["Java","Java/错题","Java/错题/待读"])("不能移入自身或子目录 %s",async parent=>{
  await expect(useStore.getState().moveNoteFolder("Java",parent)).rejects.toThrow("自己");
  expect(vault.moveNote).not.toHaveBeenCalled();
 });
 it("目标存在同名目录时拒绝合并与覆盖",async()=>{
  useStore.setState({noteFolders:[...useStore.getState().noteFolders,"空文件夹/java"]});
  await expect(useStore.getState().moveNoteFolder("Java","空文件夹")).rejects.toThrow("同名");
  expect(vault.moveNote).not.toHaveBeenCalled();expect(disk.get("a")?.folder).toBe("Java");
 });
 it("移动失败时回退已移动的笔记，保持目录和排序",async()=>{
  const folders=[...useStore.getState().noteFolders];const order={Java:["note:a","folder:Java/错题"]};useStore.setState({sidebarOrder:order});
  vi.mocked(vault.moveNote).mockImplementation(async(id,folder)=>{if(id==="b"&&folder==="空文件夹/Java/错题")throw Error("文件被占用");disk.set(id,{...disk.get(id)!,folder});});
  await expect(useStore.getState().moveNoteFolder("Java","空文件夹")).rejects.toThrow("被占用");
  expect(disk.get("a")?.folder).toBe("Java");expect(disk.get("b")?.folder).toBe("Java/错题");
  expect(useStore.getState().noteFolders).toEqual(folders);expect(useStore.getState().sidebarOrder).toEqual(order);
 });
 it("移动前未落盘的输入一并保留",async()=>{
  useStore.getState().updateNoteBody("b","刚输入的代码");
  await useStore.getState().moveNoteFolder("Java","空文件夹");await vi.runAllTimersAsync();
  expect(disk.get("b")).toMatchObject({body:"刚输入的代码",folder:"空文件夹/Java/错题"});
 });
 it("目标不存在时拒绝移动",async()=>{
  await expect(useStore.getState().moveNoteFolder("Java","不存在")).rejects.toThrow("目标文件夹");expect(vault.moveNote).not.toHaveBeenCalled();
 });
 it("移回当前父级保持不变",async()=>{
  await expect(useStore.getState().moveNoteFolder("Java/错题","Java")).resolves.toBe("Java/错题");expect(vault.moveNote).not.toHaveBeenCalled();
 });
});
