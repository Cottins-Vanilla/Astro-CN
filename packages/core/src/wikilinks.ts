/** A `[[Title]]` or `[[Title|alias]]` reference found in a note body. */
export interface WikiLink {
  target: string;
  alias?: string;
  start: number;
  end: number;
}

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
const TAG_RE = /(^|\s)#([a-zA-Z0-9_-]+)/g;

/** Parse `[[Title]]` / `[[Title|alias]]` references out of a markdown body. */
export function parseWikiLinks(body: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of body.matchAll(WIKILINK_RE)) {
    const [full, target, alias] = match;
    const start = match.index ?? 0;
    links.push({
      target: target.trim(),
      alias: alias?.trim(),
      start,
      end: start + full.length,
    });
  }
  return links;
}

/** Extract inline `#hashtags` from a markdown body. */
export function parseInlineTags(body: string): string[] {
  const tags = new Set<string>();
  for (const match of body.matchAll(TAG_RE)) {
    tags.add(match[2]);
  }
  return [...tags];
}
