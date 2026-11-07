import {describe,expect,it} from "vitest";
import {fencedPaste,clipboardMarkdown} from "../markdownClipboard";
describe("Clipboard source preservation",()=>{
 it("plain text keeps indentation and normalizes Windows newlines",()=>expect(clipboardMarkdown("","    int x;\r\n\treturn x;")).toBe("    int x;\n\treturn x;"));
 it("Markdown copied as styled source is not double escaped",()=>expect(clipboardMarkdown('<span style="font-weight:bold">## **知识点**</span>',"## **知识点**")).toBe("## **知识点**"));
 it("generic HTML wrappers preserve the plain-text line breaks",()=>expect(clipboardMarkdown('<div>甲</div><div>乙</div>',"甲\n乙")).toBe("甲\n乙"));
 it("embedded fences never prematurely close the code block",()=>expect(fencedPaste('print("```")','python')).toBe('````python\nprint("```")\n````'));
 it("code preserves blank lines and indentation",()=>expect(fencedPaste('if (a) {\r\n\r\n    run();\r\n}\r\n','java')).toBe('```java\nif (a) {\n\n    run();\n}\n```'));
});
