import { describe, expect, it } from "vitest";
import { resolveAddress, resolveEngine, SEARCH_ENGINES } from "../searchEngines";

const google = SEARCH_ENGINES[0];

describe("resolveAddress", () => {
  it("navigates to anything with a scheme, untouched", () => {
    expect(resolveAddress("https://example.com/a?b=c", google)).toBe("https://example.com/a?b=c");
    expect(resolveAddress("file:///C:/notes", google)).toBe("file:///C:/notes");
  });

  it("prefixes a bare host with https", () => {
    expect(resolveAddress("example.com", google)).toBe("https://example.com");
    expect(resolveAddress("example.com/path", google)).toBe("https://example.com/path");
    expect(resolveAddress("localhost:5173", google)).toBe("https://localhost:5173");
  });

  it("searches anything that isn't a URL — the whole point of the setting", () => {
    expect(resolveAddress("how do i fix this", google)).toBe("https://www.google.com/search?q=how%20do%20i%20fix%20this");
    // A single word is a query, not a hostname.
    expect(resolveAddress("astronomy", google)).toBe("https://www.google.com/search?q=astronomy");
  });

  it("uses the configured engine", () => {
    const ddg = resolveEngine("duckduckgo", "");
    expect(resolveAddress("orion", ddg)).toBe("https://duckduckgo.com/?q=orion");
  });
});

describe("resolveEngine", () => {
  it("falls back to Google for an unknown id", () => {
    expect(resolveEngine("nope", "").id).toBe("google");
  });

  it("uses a custom template only once it has a %s placeholder", () => {
    expect(resolveEngine("custom", "https://kagi.com/search?q=%s").query).toBe("https://kagi.com/search?q=%s");
    expect(resolveEngine("custom", "https://kagi.com/search?q=").id).toBe("google");
  });

  it("survives a half-typed custom template without throwing", () => {
    expect(resolveEngine("custom", "htt%s").home).toBe(google.home);
  });
});
