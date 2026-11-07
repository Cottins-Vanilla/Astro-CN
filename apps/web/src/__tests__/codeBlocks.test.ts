import { describe, expect, it } from "vitest";
import { codeBlockInsertion } from "../codeBlocks";
describe("代码块插入", () => {
 it("空白笔记插入 Java 代码块，并将光标放到代码区域", () => {
  const r=codeBlockInsertion("",0,0,"java");
  expect(r.insert).toBe("```java\n\n```\n"); expect(r.anchor).toBe(8);
 });
 it("将选中的多行代码转为代码块，保留缩进", () => {
  const code="if (ok) {\n  run();\n}";
  const r=codeBlockInsertion(code,0,code.length,"javascript");
  expect(r.insert).toContain("\n"+code+"\n");
 });
 it("代码包含反引号时，使用更长的围栏以防提前结束", () => {
  expect(codeBlockInsertion("```",0,3,"text").insert).toBe("````text\n```\n````\n");
 });
 it("在正文中间插入时另起一段，不吞掉前后文字", () => {
  const r=codeBlockInsertion("前文后文",2,2,"python");
  expect("前文后文".slice(0,2)+r.insert+"前文后文".slice(2)).toBe("前文\n\n```python\n\n```\n后文");
 });
});
