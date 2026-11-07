import { marked } from "marked";
import DOMPurify from "dompurify";
import { parseWikiLinks } from "@solen/core";

/**
 * Render a note body to sanitized HTML for display (note-card previews).
 * `[[Wiki Links]]` are swapped for accent-colored spans *before* markdown
 * parsing (marked has no notion of wiki-link syntax) so they survive as
 * plain inline HTML; clicking one is wired up by the caller via a
 * `data-wikilink` attribute holding the (encoded) target title.
 *
 * `knownTitles` — lower-cased note titles that resolve to a real note — lets
 * unresolved links render as dimmer "ghost" links, matching
 * docs/DATA-FORMAT.md's ghost-note concept. Omit it to treat every link as
 * resolved (e.g. before the note list has loaded).
 */
export function renderMarkdown(body: string, knownTitles?: ReadonlySet<string>): string {
  const withWikiLinkSpans = replaceWikiLinks(body, knownTitles);
  const html = marked.parse(withWikiLinkSpans, { async: false, gfm: true });
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-wikilink"] });
}

function replaceWikiLinks(body: string, knownTitles?: ReadonlySet<string>): string {
  const links = parseWikiLinks(body);
  if (links.length === 0) return body;

  let out = "";
  let cursor = 0;
  for (const link of links) {
    out += body.slice(cursor, link.start);
    const label = escapeHtml(link.alias ?? link.target);
    const resolved = !knownTitles || knownTitles.has(link.target.toLowerCase());
    const cls = resolved ? "wiki-link" : "wiki-link ghost";
    out += `<span class="${cls}" data-wikilink="${encodeURIComponent(link.target)}">${label}</span>`;
    cursor = link.end;
  }
  out += body.slice(cursor);
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
