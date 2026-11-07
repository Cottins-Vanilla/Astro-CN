import { describe, expect, it } from "vitest";
import { folderPath, folderTree, allFolderPaths, canonicalFolderPath, renameFolderPlan, applyFolderMoves } from "../noteFolders";
describe("笔记文件夹", () => {
  it("补齐父级、去重并保持完整路径", () => {
    const tree=folderTree(["Java/错题","Java/知识点","项目","Java/错题"]);
    expect(allFolderPaths(tree)).toHaveLength(4);
    expect(tree.find(n=>n.path==="Java")?.children.map(n=>n.name)).toEqual(expect.arrayContaining(["错题","知识点"]));
  });
  it("空文件夹也能进入分类树", () => {
    expect(allFolderPaths(folderTree(["待读","Java/错题"]))).toContain("待读");
  });
  it("中文路径可用，层级两侧空格会清理", () => {
    expect(folderPath(" 项目 / Java ")).toBe("项目/Java");
  });
  it.each(["../外部","/绝对路径","C:/外部","a\\b","a//b","a/../b","CON","a.",""])("拒绝无效或越界目录 %s", input => {
    expect(()=>folderPath(input)).toThrow();
  });
  it("复用现有父级大小写，避免出现两棵同名目录树", () => {
    expect(canonicalFolderPath("java/错题",["Java"])).toBe("Java/错题");
  });
});

describe("文件夹改名校验", () => {
  it.each(["", "../外部", "a/b", "CON", "a."])("拒绝无效名称 %s", name => {
    expect(() => renameFolderPlan("Java", name, ["Java"], [])).toThrow();
  });
  it("回滚失败会明确提示，避免声称操作成功", async () => {
    const moved: string[] = [];
    await expect(applyFolderMoves([{id:"a",from:"旧",to:"新"},{id:"b",from:"旧",to:"新"}], async (id, target) => {
      if (id === "b" || target === "旧") throw new Error("被占用");
      moved.push(id);
    })).rejects.toThrow("部分笔记");
    expect(moved).toEqual(["a"]);
  });
});


