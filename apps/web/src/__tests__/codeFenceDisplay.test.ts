import { describe, expect, it } from "vitest";
import { codeFenceBlocks } from "../codeFenceDisplay";
describe("隐藏代码围栏", () => {
 it("只定位开头和结尾，保留中间代码", () => {
  const doc="说明\n```java\nint count = 3;\n```\n后文";
  const [block]=codeFenceBlocks(doc);
  expect(block.language).toBe("java");
  expect(doc.slice(block.bodyFrom,block.bodyTo)).toBe("int count = 3;");
  expect(doc.slice(block.opening.from,block.opening.to)).toBe("```java");
  expect(doc.slice(block.closing!.from,block.closing!.to)).toBe("```");
 });
 it("较长围栏里的三个反引号仍属于代码", () => {
  const doc="````text\n```\n````";
  const [block]=codeFenceBlocks(doc);
  expect(doc.slice(block.bodyFrom,block.bodyTo)).toBe("```");
 });
 it("分别处理多个代码块和波浪线围栏", () => {
  const doc="```java\na();\n```\n文字\n~~~python\nprint(1)\n~~~";
  expect(codeFenceBlocks(doc).map(b=>b.language)).toEqual(["java","python"]);
 });
 it("正文中的反引号不当成围栏", () => {
  expect(codeFenceBlocks("说明里有 ```java 标记")).toEqual([]);
 });
 it("未闭合代码块保留正文到文件结尾", () => {
  const doc="```java\nint a=1;";
  const [block]=codeFenceBlocks(doc);
  expect(block.closing).toBeUndefined();
  expect(doc.slice(block.bodyFrom,block.bodyTo)).toBe("int a=1;");
 });
});
