import {describe,expect,it} from "vitest";
import {moveSidebarFolder,orderedSidebarItems,reorderSidebarItems,readSidebarOrder,renameSidebarFolder,deleteSidebarFolder} from "../sidebarOrdering";
describe("侧栏同级排序",()=>{
 const keys=["folder:Java","folder:Python","note:a","note:b"];
 it("文件夹与笔记可以混合排列",()=>{expect(reorderSidebarItems(keys,"note:a","folder:Java",false)).toEqual(["note:a","folder:Java","folder:Python","note:b"]);});
 it("支持向下移动到目标后面",()=>{expect(reorderSidebarItems(keys,"folder:Java","note:b",true)).toEqual(["folder:Python","note:a","note:b","folder:Java"]);});
 it("拒绝不属于当前层级的源或目标",()=>{expect(reorderSidebarItems(keys,"note:foreign","note:a",false)).toBe(keys);expect(reorderSidebarItems(keys,"note:a","folder:child",false)).toBe(keys);});
 it("放在自己身上不改变顺序",()=>{expect(reorderSidebarItems(keys,"note:a","note:a",true)).toBe(keys);});
 it("保存的顺序覆盖默认排序，忽略已删除项",()=>{expect(orderedSidebarItems(keys.map(key=>({key})),"",{" ":[],"":["note:deleted","note:b","folder:Java"]}).map(r=>r.key)).toEqual(["note:b","folder:Java","folder:Python","note:a"]);});
 it("新增项排在保存的项后面且不丢失",()=>{expect(orderedSidebarItems([{key:"note:new"},{key:"note:a"}],"Java",{Java:["note:a"]}).map(r=>r.key)).toEqual(["note:a","note:new"]);});
 it("不同文件夹各自保存顺序",()=>{expect(orderedSidebarItems(keys.map(key=>({key})),"Java",{Java:["note:b"],Python:["note:a"]})[0].key).toBe("note:b");});
 it("兼容旧配置与异常配置",()=>{expect(readSidebarOrder(undefined)).toEqual({});expect(readSidebarOrder({Java:["note:a",7,"note:a","garbage"]})).toEqual({Java:["note:a"]});});
 it("文件夹改名保留位置和所有子层级顺序",()=>{expect(renameSidebarFolder({"":["note:a","folder:Java","folder:JavaScript"],Java:["folder:Java/错题","note:b"],"Java/错题":["note:c"]},"Java","后端")).toEqual({"":["note:a","folder:后端","folder:JavaScript"],后端:["folder:后端/错题","note:b"],"后端/错题":["note:c"]});});
 it("删除文件夹清理子树排序且不影响前缀相似文件夹",()=>{expect(deleteSidebarFolder({"":["folder:Java","note:a","folder:JavaScript"],Java:["note:b"],"Java/错题":["note:c"],JavaScript:["note:d"]},"Java")).toEqual({"":["note:a","folder:JavaScript"],JavaScript:["note:d"]});});
 it("特殊名称也可作为父级安全保存",()=>{const order=readSidebarOrder(JSON.parse('{"__proto__":["note:a"]}'));expect(orderedSidebarItems([{key:"note:b"},{key:"note:a"}],"__proto__",order)[0].key).toBe("note:a");});
});

describe("移动目录后的排列",()=>{
 it("保留内部顺序，移除旧父级条目并加入新父级",()=>{
  expect(moveSidebarFolder({A:["folder:A/子","note:a"],"A/子":["note:b"],B:["note:c"]},"A/子","B/子",["folder:A/子","note:a"],["note:c"])).toEqual({A:["note:a"],"B/子":["note:b"],B:["note:c","folder:B/子"]});
 });
 it("特殊名称可安全作为新父级",()=>{
  const order=moveSidebarFolder({},"A","__proto__/A",["folder:A"],[]);
  expect(Object.hasOwn(order,"__proto__")).toBe(true);expect(order["__proto__"]).toEqual(["folder:__proto__/A"]);
 });
});
