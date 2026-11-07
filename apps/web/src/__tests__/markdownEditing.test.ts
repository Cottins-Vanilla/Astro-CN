import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownFormat, type MarkdownAction } from "../markdownEditing";
function format(doc: string, action: MarkdownAction, from=0, to=doc.length) {
 const state=EditorState.create({doc,selection:{anchor:from,head:to}});
 return state.update(markdownFormat(state,action)).state;
}
describe("Markdown formatting", () => {
 it("preserves text while making it bold and toggles it off", () => {
  const state=format("知识点","bold");
  expect(state.doc.toString()).toBe("**知识点**");
  expect(state.update(markdownFormat(state,"bold")).state.doc.toString()).toBe("知识点");
 });
 it("creates selected placeholder in an empty note",()=>{
  const state=format("","italic");
  expect(state.doc.toString()).toBe("*文字*");
  expect(state.sliceDoc(state.selection.main.from,state.selection.main.to)).toBe("文字");
 });
 it("applies lists to all selected lines",()=>{expect(format("第一条\n第二条","list").doc.toString()).toBe("- 第一条\n- 第二条");});
 it("does not modify the line after a selection ending at its start",()=>{expect(format("第一条\n第二条","quote",0,4).doc.toString()).toBe("> 第一条\n第二条");});
 it("toggles heading marks without stacking",()=>{expect(format("### 标题","heading").doc.toString()).toBe("标题");});
 it("numbers multiline selections",()=>{expect(format("甲\n乙","ordered").doc.toString()).toBe("1. 甲\n2. 乙");});
 it("preserves selection as link label and selects address",()=>{
  const state=format("官网","link");
  expect(state.doc.toString()).toBe("[官网](https://)");
  expect(state.sliceDoc(state.selection.main.from,state.selection.main.to)).toBe("https://");
 });
 it("wraps inline code without dropping neighboring content",()=>{expect(format("调用 castSpell 方法","inlineCode",3,12).doc.toString()).toBe("调用 `castSpell` 方法");});
});
