import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLinkIndex, type Note } from "@solen/core";
import { useStore, vault } from "../store";
import { loadLinkIndex } from "../linkIndex";
import { wikiLinksAfterRename } from "../noteLinks";
const make=(id:string,title:string,body="",folder?:string):Note=>({id,title,body,folder,tags:[],createdAt:"",updatedAt:""});
let disk:Map<string,Note>;
function seed(notes:Note[]) {
 disk=new Map(notes.map(n=>[n.id,{...n}]));
 useStore.setState({notes:Object.fromEntries(notes.map(n=>[n.id,{...n}])),noteList:notes.map(({body,...n})=>n),openNoteId:null});
}
beforeEach(()=>{
 vi.useFakeTimers();
 seed([make("a","原笔记","# 我的代码\n正文","Java"),make("b","引用笔记","参见 [[原笔记]] 和 [[Java/原笔记.md#重点|例子]]。")]);
 vi.spyOn(vault,"listNotes").mockImplementation(async()=>[...disk.values()].map(({body,...n})=>n));
 vi.spyOn(vault,"readNote").mockImplementation(async id=>{if(!disk.has(id))throw Error("不存在");return {...disk.get(id)!};});
 vi.spyOn(vault,"writeNote").mockImplementation(async n=>{disk.set(n.id,{...n});});
 vi.spyOn(vault,"listCanvases").mockResolvedValue([]);
 vi.spyOn(vault,"rescan").mockImplementation(async()=>[...disk.values()].map(({body,...n})=>n));
});
afterEach(async()=>{await vi.runAllTimersAsync();vi.restoreAllMocks();vi.useRealTimers();});
describe("星图中的笔记改名",()=>{
 it("标题输入完成后同步原节点和引用，不增加笔记或旧标题虚节点",async()=>{
  await useStore.getState().openNote("a");
  useStore.getState().updateNoteTitle("a","新笔记");
  await vi.runAllTimersAsync();
  const index=await loadLinkIndex();
  expect(disk.size).toBe(2);
  expect(index.nodes).toHaveLength(2);
  expect(index.nodes.find(n=>n.id==="a")).toMatchObject({title:"新笔记"});
  expect(index.nodes.some(n=>n.ghost)).toBe(false);
  expect(index.edges.every(e=>e.to==="a")).toBe(true);
  expect(disk.get("b")!.body).toBe("参见 [[Java/新笔记]] 和 [[Java/新笔记.md#重点|例子]]。");
  expect(disk.get("a")!.body).toBe("# 我的代码\n正文");
  expect(useStore.getState().openNoteId).toBe("a");
 });
 it("清空标题后保存为未命名，不产生空标题引用",async()=>{
  useStore.getState().updateNoteTitle("a","  ");await useStore.getState().flushNoteSaves();
  expect(disk.get("a")!.title).toBe("未命名");
  expect(disk.get("b")!.body).toContain("[[Java/未命名]]");
  expect((await loadLinkIndex()).nodes.some(n=>n.ghost)).toBe(false);
 });
 it("侧栏重命名同步未打开的反向引用，保留未保存的正文",async()=>{
  useStore.setState({notes:{a:useStore.getState().notes.a}});
  useStore.getState().updateNoteBody("a","刚输入的代码");
  await useStore.getState().renameNote("a"," 改名完成 ");
  expect(disk.get("a")).toMatchObject({id:"a",title:"改名完成",body:"刚输入的代码",folder:"Java"});
  expect(disk.get("b")!.body).toContain("[[Java/改名完成]]");
 });
 it("连续输入与连续改名不会遗留中间标题",async()=>{
  const state=useStore.getState();
  state.updateNoteTitle("a","临");state.updateNoteTitle("a","临时");state.updateNoteTitle("a","最终标题");
  await state.flushNoteSaves();
  state.updateNoteTitle("a","第二次标题");await state.flushNoteSaves();
  expect(disk.get("b")!.body).toContain("[[Java/第二次标题]]");
  expect((await loadLinkIndex()).nodes).toHaveLength(2);
 });
 it("另一个文件夹的同名笔记及其引用保持不变",async()=>{
  seed([make("a","原笔记","","Java"),make("b","来源","[[原笔记]]","Java"),make("c","原笔记","","Python"),make("d","其他来源","[[原笔记]]","Python")]);
  await useStore.getState().renameNote("a","新标题");
  expect(disk.get("b")!.body).toBe("[[Java/新标题]]");
  expect(disk.get("d")!.body).toBe("[[原笔记]]");
  expect(disk.get("c")!.title).toBe("原笔记");
  expect(buildLinkIndex([...disk.values()],[]).nodes.some(n=>n.ghost)).toBe(false);
 });
 it("星图读取等待慢速保存，不能读到只改标题尚未更新引用的状态",async()=>{
  let finish:(()=>void)|undefined;
  vi.mocked(vault.writeNote).mockImplementationOnce(n=>new Promise<void>(resolve=>{finish=()=>{disk.set(n.id,{...n});resolve();};}));
  useStore.getState().updateNoteTitle("a","慢速改名");
  let finished=false;const reading=loadLinkIndex().then(index=>{finished=true;return index;});
  for(let i=0;i<30;i++)await Promise.resolve();
  expect(finish).toBeTypeOf("function");expect(finished).toBe(false);
  const rescan=useStore.getState().rescanVault();
  finish!();const index=await reading;await rescan;
  expect(index.nodes.some(n=>n.ghost)).toBe(false);
  expect(useStore.getState().notes.a.title).toBe("慢速改名");
 });
 it("保存过程中继续输入标题和正文也不会丢失",async()=>{
  let finish:(()=>void)|undefined;
  vi.mocked(vault.writeNote).mockImplementationOnce(n=>new Promise<void>(resolve=>{finish=()=>{disk.set(n.id,{...n});resolve();};}));
  useStore.getState().updateNoteTitle("a","第一次");
  const saving=useStore.getState().flushNoteSaves();for(let i=0;i<30;i++)await Promise.resolve();
  useStore.getState().updateNoteTitle("a","第二次");useStore.getState().updateNoteBody("a","仍在输入");
  finish!();await saving;await useStore.getState().flushNoteSaves();
  expect(disk.get("a")).toMatchObject({title:"第二次",body:"仍在输入"});
  expect(disk.get("b")!.body).toContain("[[Java/第二次]]");
 });
 it("写入失败恢复磁盘版本，再次保存可完成全部引用更新",async()=>{
  vi.mocked(vault.writeNote).mockRejectedValueOnce(new Error("模拟写入失败"));
  await expect(useStore.getState().renameNote("a","失败重试")).rejects.toThrow("模拟写入失败");
  expect(disk.get("a")!.title).toBe("原笔记");
  expect(disk.get("b")!.body).toContain("[[原笔记]]");
  await useStore.getState().renameNote("a","失败重试");
  expect(disk.get("b")!.body).toContain("[[Java/失败重试]]");
  expect((await loadLinkIndex()).nodes.some(n=>n.ghost)).toBe(false);
 });
 it("反向引用写入失败后再次换名，也不会遗留失败的标题",async()=>{
  let calls=0;
  vi.mocked(vault.writeNote).mockImplementation(async n=>{if(++calls===2)throw Error("引用写入失败");disk.set(n.id,{...n});});
  await expect(useStore.getState().renameNote("a","未完成的改名")).rejects.toThrow("引用写入失败");
  expect(disk.get("a")!.title).toBe("原笔记");
  expect(useStore.getState().notes.a.title).toBe("原笔记");
  await useStore.getState().renameNote("a","另一个名称");
  expect(disk.get("b")!.body).toContain("[[Java/另一个名称]]");
  expect((await loadLinkIndex()).nodes.some(n=>n.ghost)).toBe(false);
 });
 it("重复标题、自引用、路径、别名、锚点和大小写按原解析规则处理",()=>{
  const notes=[make("a","Old","[[Old]]"),make("b","Source","[[OLD#^block|显示原文字]] [[./Old.md]] [[未知]]")];
  const rewrite=wikiLinksAfterRename(notes,notes[0],"新标题");
  expect(rewrite(notes[0])).toBe("[[新标题]]");
  expect(rewrite(notes[1])).toBe("[[新标题#^block|显示原文字]] [[新标题.md]] [[未知]]");
 });
});
