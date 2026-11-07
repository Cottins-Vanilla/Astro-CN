import { describe, expect, it } from "vitest";
import { parseInlineTags, parseWikiLinks } from "../wikilinks.js";

describe("parseWikiLinks", () => {
  it("parses a plain wiki-link", () => {
    const links = parseWikiLinks("See [[Distributed Systems]] for more.");
    expect(links).toEqual([
      { target: "Distributed Systems", alias: undefined, start: 4, end: 27 },
    ]);
  });

  it("parses an aliased wiki-link", () => {
    const links = parseWikiLinks("Check [[Raft|the Raft paper]].");
    expect(links).toEqual([
      { target: "Raft", alias: "the Raft paper", start: 6, end: 29 },
    ]);
  });

  it("parses multiple links", () => {
    const links = parseWikiLinks("[[A]] and [[B|b]]");
    expect(links.map((l) => l.target)).toEqual(["A", "B"]);
    expect(links[1].alias).toBe("b");
  });

  it("returns an empty array when there are no links", () => {
    expect(parseWikiLinks("no links here")).toEqual([]);
  });
});

describe("parseInlineTags", () => {
  it("extracts hashtags", () => {
    expect(parseInlineTags("Some #reading and #systems notes")).toEqual([
      "reading",
      "systems",
    ]);
  });

  it("deduplicates tags", () => {
    expect(parseInlineTags("#a #a #b")).toEqual(["a", "b"]);
  });

  it("ignores a leading # mid-word", () => {
    expect(parseInlineTags("no#tag here")).toEqual([]);
  });
});
