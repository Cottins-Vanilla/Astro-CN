import {describe,expect,it} from "vitest";
import {markdownHiddenRanges} from "../markdownPresentation";
const visible=(doc:string)=>{let text=doc;for(const r of [...markdownHiddenRanges(doc)].reverse())text=text.slice(0,r.from)+(r.text??(r.kind==='task'?'☑':''))+text.slice(r.to);return text;};
describe("Markdown display without source markers",()=>{
 it("hides title and emphasis markers together",()=>expect(visible("## **施法方法**")).toBe("施法方法"));
 it("hides italic and strike markers",()=>expect(visible("*提示* 和 ~~旧写法~~")).toBe("提示 和 旧写法"));
 it("preserves asterisks and hashes inside inline code",()=>expect(visible("`## **代码**`")).toBe("## **代码**"));
 it("does not interpret fenced code as formatting",()=>{const text='```java\n// ## **literal**\n```';expect(markdownHiddenRanges(text)).toEqual([]);});
 it("replaces list and quote syntax",()=>expect(visible("> 提示\n\n- 第一条")).toBe("提示\n\n•第一条"));
 it("renders tasks as checkboxes",()=>expect(markdownHiddenRanges("- [x] 已完成").some(r=>r.kind==='task'&&r.checked)).toBe(true));
 it("hides link address and keeps its label",()=>expect(visible("[官网](https://example.com)")).toBe("官网"));
 it("keeps escaped literal punctuation visible",()=>expect(visible("\\*不是加粗\\*")).toBe("*不是加粗*"));
 it("uses a table block instead of displaying pipe markers",()=>expect(markdownHiddenRanges("| 项目 | 说明 |\n| --- | --- |\n| A | B |")[0]?.kind).toBe("table"));
 it("leaves unfinished and ordinary hashes alone",()=>expect(visible("C# 和 2 * 3，##不是标题")).toBe("C# 和 2 * 3，##不是标题"));
});
