import DOMPurify from "dompurify";

const safeUrl = (value: string) => /^(https?:\/\/|mailto:)/i.test(value.trim()) ? value.trim() : "";
const escapeText = (text: string) => text.replace(/\u00a0/g, " ").replace(/\\/g, "\\\\").replace(/([`*_\[\]<>])/g, "\\$1").replace(/^(\s*)(#{1,6}|>|[-+])(\s)/gm, "$1\\$2$3");
const trimBlock = (text: string) => text.replace(/^\n+|\n+$/g, "");
export function fencedPaste(text: string, language = ""): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(s => s.length));
  const fence = "`".repeat(longest + 1);
  return fence + language.replace(/[^\w+#.-]/g, "") + "\n" + text.replace(/\r\n?/g, "\n").replace(/\n$/, "") + "\n" + fence;
}

/** Convert clipboard HTML only. No raw HTML, executable attributes or local-file links survive. */
export function htmlToMarkdown(html: string): string {
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "script", "iframe", "object", "svg", "math"] });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  function children(node: Node): string { return [...node.childNodes].map(convert).join(""); }
  function cell(el: Element): string { return trimBlock(children(el)).replace(/\n+/g, "<br>").replace(/\|/g, "\\|"); }
  function list(el: Element, depth = 0): string {
    const start = Number(el.getAttribute("start")) || 1;
    return [...el.children].filter(n => n.tagName === "LI").map((li, i) => {
      let content = "", nested = "";
      for (const node of li.childNodes) {
        if (node instanceof Element && ["UL", "OL"].includes(node.tagName)) nested += "\n" + list(node, depth + 1);
        else content += convert(node);
      }
      const input = li.querySelector('input[type="checkbox"]');
      if (input) content = "[" + ((input as HTMLInputElement).checked || input.hasAttribute("checked") ? "x" : " ") + "] " + content.trim();
      const prefix = el.tagName === "OL" ? String(start + i) + ". " : "- ";
      const indent = "    ".repeat(depth);
      return indent + prefix + trimBlock(content).trim().replace(/\n/g, "\n" + indent + " ".repeat(prefix.length)) + nested;
    }).join("\n");
  }
  function convert(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? "").replace(/[\t\r\n ]+/g, " ");
    if (!(node instanceof Element)) return "";
    const tag = node.tagName;
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(tag)) return "";
    if (tag === "BR") return "\n";
    if (tag === "HR") return "\n\n---\n\n";
    if (tag === "INPUT") return "";
    if (tag === "PRE") {
      const code = node.querySelector("code");
      const classes = (code?.className ?? "") + " " + node.className;
      const language = /(?:language|lang)-([\w+#.-]+)/.exec(classes)?.[1] ?? node.getAttribute("data-language") ?? "";
      return "\n\n" + fencedPaste((code ?? node).textContent ?? "", language) + "\n\n";
    }
    if (tag === "CODE") {
      const text = node.textContent ?? "";
      const fence = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map(s => s.length)) + 1);
      const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return fence + padding + text + padding + fence;
    }
    if (tag === "UL" || tag === "OL") return "\n\n" + list(node) + "\n\n";
    if (tag === "TABLE") {
      const rows = [...node.querySelectorAll("tr")].filter(tr => tr.closest("table") === node).map(tr => [...tr.children].filter(c => /^(TD|TH)$/.test(c.tagName)).map(cell));
      if (!rows.length) return "";
      const width = Math.max(...rows.map(r => r.length));
      const line = (r: string[]) => "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |";
      return "\n\n" + [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n") + "\n\n";
    }
    const content = children(node);
    const text = content.trim();
    if (/^H[1-6]$/.test(tag)) return "\n\n" + "#".repeat(Number(tag[1])) + " " + text + "\n\n";
    if (tag === "BLOCKQUOTE") return "\n\n" + trimBlock(content).split("\n").map(l => "> " + l).join("\n") + "\n\n";
    if (tag === "A") { const url = safeUrl(node.getAttribute("href") ?? ""); return url && text ? "[" + text + "](" + url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29") + ")" : content; }
    if (tag === "IMG") { const alt = node.getAttribute("alt") ?? ""; const src = safeUrl(node.getAttribute("src") ?? ""); return src ? "![" + escapeText(alt) + "](" + src.replace(/\)/g, "%29") + ")" : escapeText(alt); }
    const weight = (node as HTMLElement).style.fontWeight;
    const bold = ["STRONG", "B"].includes(tag) || weight === "bold" || Number(weight) >= 600;
    const italic = ["EM", "I"].includes(tag) || (node as HTMLElement).style.fontStyle === "italic";
    let formatted = content;
    if (text && ["DEL", "S", "STRIKE"].includes(tag)) formatted = "~~" + text + "~~";
    if (text && italic) formatted = "*" + formatted.trim() + "*";
    if (text && bold) formatted = "**" + formatted.trim() + "**";
    if (["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER"].includes(tag)) return "\n\n" + trimBlock(formatted).trim() + "\n\n";
    if (text && (bold || italic || ["DEL", "S", "STRIKE"].includes(tag))) {
      return (/^\s/.test(content) ? " " : "") + formatted + (/\s$/.test(content) ? " " : "");
    }
    return formatted;
  }
  // Collapse gaps between HTML blocks without altering whitespace inside code fences.
  const output = children(doc.body);
  const lines = output.split("\n"); let fence = "", blanks = 0;
  return lines.filter(line => {
    const match = /^(`{3,})/.exec(line);
    if (match) { fence = fence ? (match[1].length >= fence.length ? "" : fence) : match[1]; blanks = 0; return true; }
    if (fence) return true;
    if (!line.trim()) return ++blanks < 2;
    blanks = 0; return true;
  }).join("\n").trim();
}

export function clipboardMarkdown(html: string, plain: string): string {
  if (!html) return plain.replace(/\r\n?/g, "\n");
  if (plain && /(?:^#{1,6} |^`{3,}|\*\*[^*\n]+\*\*)/m.test(plain) && !/<(?:pre|code)\b/i.test(html)) return plain.replace(/\r\n?/g, "\n");
  const semantic = /<(?:h[1-6]|strong|b|em|i|pre|code|ul|ol|blockquote|table|del|s|a|img|hr|input)\b|font-(?:weight|style)\s*:/i.test(html);
  // Source copies and generic editor wrappers already carry useful plain Markdown.
  if (!semantic && plain) return plain.replace(/\r\n?/g, "\n");
  return htmlToMarkdown(html) || plain.replace(/\r\n?/g, "\n");
}
