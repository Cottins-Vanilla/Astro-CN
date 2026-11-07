export const CODE_LANGUAGES = [
 ["java","Java"],["javascript","JavaScript"],["typescript","TypeScript"],["python","Python"],
 ["cpp","C++"],["csharp","C#"],["go","Go"],["rust","Rust"],["sql","SQL"],
 ["html","HTML"],["css","CSS"],["json","JSON"],["bash","Shell 命令"],["","普通文本"],
] as const;
export function codeBlockInsertion(doc: string, from: number, to: number, language: string) {
 const selected = doc.slice(from, to);
 const fence = "`".repeat(Math.max(3, ...(selected.match(/`+/g) ?? []).map(run => run.length + 1)));
 const prefix = from > 0 && doc[from - 1] !== "\n" ? "\n\n" : "";
 const opening = prefix + fence + language + "\n";
 return { insert: opening + selected + (selected.endsWith("\n") ? "" : "\n") + fence + "\n", anchor: from + opening.length + selected.length };
}
