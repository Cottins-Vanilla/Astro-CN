/**
 * The web viewer's search engines (Settings → Web). Google is the default; the rest are the
 * engines a user is likely to already have muscle memory for, plus a free-form custom entry for
 * anything not listed (self-hosted SearXNG, Kagi, Perplexity, …).
 *
 * `query` is a URL template with a literal `%s` where the encoded query goes — the same convention
 * Chrome and Firefox use for custom search engines, so a URL copied out of either works here.
 */
export interface SearchEngine {
  id: string;
  label: string;
  /** URL template — `%s` is replaced with the URI-encoded query. */
  query: string;
  /** Page opened by the "Open web viewer" quick action and a new web tab. */
  home: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: "google", label: "Google", query: "https://www.google.com/search?q=%s", home: "https://www.google.com" },
  { id: "duckduckgo", label: "DuckDuckGo", query: "https://duckduckgo.com/?q=%s", home: "https://duckduckgo.com" },
  { id: "brave", label: "Brave 搜索", query: "https://search.brave.com/search?q=%s", home: "https://search.brave.com" },
  { id: "bing", label: "必应", query: "https://www.bing.com/search?q=%s", home: "https://www.bing.com" },
  { id: "ecosia", label: "Ecosia", query: "https://www.ecosia.org/search?q=%s", home: "https://www.ecosia.org" },
  { id: "custom", label: "自定义…", query: "", home: "" },
];

export const DEFAULT_SEARCH_ENGINE = "google";

/** Resolves the engine to use: the custom template when `id` is "custom" and one is configured,
 * otherwise the matching preset, otherwise Google. */
export function resolveEngine(id: string, customQuery: string): SearchEngine {
  if (id === "custom" && customQuery.includes("%s")) {
    return { id: "custom", label: "自定义", query: customQuery, home: originOf(customQuery) };
  }
  return SEARCH_ENGINES.find((e) => e.id === id && e.id !== "custom") ?? SEARCH_ENGINES[0];
}

/** Best-effort origin of a custom template, used as its home page. A half-typed template is
 * expected here (the field is edited live), so an unparseable one falls back to Google's home
 * rather than throwing inside a render. */
function originOf(template: string): string {
  try {
    return new URL(template.replace("%s", "")).origin;
  } catch {
    return SEARCH_ENGINES[0].home;
  }
}

/**
 * Turns whatever was typed into the address bar into a URL: a real URL (scheme, or a bare
 * `host.tld[/path]`) is navigated to directly, anything else is a search query. Replaces the old
 * `normalizeUrl`, which prefixed *everything* with https:// — so typing a search term navigated to
 * `https://<the whole sentence>` and failed to resolve.
 */
export function resolveAddress(input: string, engine: SearchEngine): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(trimmed) && !/\s/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return engine.query.replace("%s", encodeURIComponent(trimmed));
}
