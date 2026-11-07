import { createWikiLinkResolver, parseWikiLinks, type Note } from "@solen/core";

/**
 * Remove every `[[Title]]` / `[[Title|alias]]` occurrence targeting
 * `targetTitle` (case-insensitive) from a note body. Used only by the graph's
 * edge Unlink action for the rare wikilink-sourced edge — hand-typed
 * `[[links]]` remain supported, but no 3D-graph gesture writes them (see
 * docs/WORKSPACE-3D.md: gesture-created links are structural canvas edges).
 * A link that lived alone on its own line (the common case) removes the
 * whole line; an inline link just loses its bracket text.
 */
export function removeWikiLinkOccurrences(body: string, targetTitle: string): string {
  const lower = targetTitle.toLowerCase();
  const links = parseWikiLinks(body).filter((l) => l.target.toLowerCase() === lower);
  if (links.length === 0) return body;

  let result = body;
  for (let i = links.length - 1; i >= 0; i--) {
    const { start, end } = links[i];
    const lineStart = result.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = result.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = result.length;
    const restOfLine = result.slice(lineStart, start) + result.slice(end, lineEnd);
    if (restOfLine.trim() === "") {
      const hasTrailingNewline = result[lineEnd] === "\n";
      result = result.slice(0, lineStart) + result.slice(hasTrailingNewline ? lineEnd + 1 : lineEnd);
    } else {
      result = result.slice(0, start) + result.slice(end);
    }
  }

  // Drop a trailing "## Links" heading that appendConnection-style writers
  // add, if removal left it with nothing under it.
  result = result.replace(/(?:^|\n)#{1,3}\s*Links\s*(?=\n|$)\n?$/, "");
  return result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/** Retarget only references that resolved to this exact note before its rename. */
export function wikiLinksAfterRename(notes: Note[], renamed: Note, title: string): (note: Note) => string {
  const resolve = createWikiLinkResolver(notes);
  // Full paths keep the destination unambiguous when another folder has the same title.
  const target = renamed.folder ? renamed.folder + "/" + title : title;
  return note => {
    let body = note.body;
    const links = parseWikiLinks(body);
    for (let i = links.length - 1; i >= 0; i--) {
      const link = links[i];
      if (resolve(link.target, note)?.id !== renamed.id) continue;
      const raw = body.slice(link.start, link.end);
      // Keep heading/block suffixes, explicit display aliases, and .md links intact.
      const match = /^(\[\[\s*)([^|\]]+?)(\s*(?:\|[^\]]+)?\]\])$/.exec(raw);
      if (!match) continue;
      const heading = match[2].match(/#.*$/)?.[0] ?? "";
      const extension = /\.md$/i.test(match[2].replace(/#.*$/, "")) ? ".md" : "";
      body = body.slice(0, link.start) + match[1] + target + extension + heading + match[3] + body.slice(link.end);
    }
    return body;
  };
}
