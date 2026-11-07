import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { buildConstellationPatterns, type ConstellationPatternData } from "@solen/core";

const LINES_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json";
const NAMES_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json";
const CACHE_FILE = "constellations.json";

/** Bump whenever `buildConstellationPatterns`'s transform logic changes in a way that would make
 * an already-cached download stale/wrong (e.g. the 2026-07-24 fix from English "Air Pump"-style
 * names to Latin/IAU ones) — a mismatched cache is treated as absent, so main.ts's existing
 * "download if no cache exists yet" path re-fetches automatically instead of an old download
 * silently overriding a fixed bundled `patterns.ts` forever. */
const CACHE_SCHEMA_VERSION = 2;

interface CacheFile {
  schemaVersion: number;
  patterns: ConstellationPatternData[];
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function cachePath(userDataDir: string): string {
  return path.join(userDataDir, CACHE_FILE);
}

/**
 * The runtime half of docs/ARCH-CONSTELLATIONS.md's "downloading a fresh copy": fetches the real
 * IAU constellation line-figure data from d3-celestial (same source `scripts/build-constellation-
 * patterns.js` uses to bake the bundled `patterns.ts` fallback) and caches the processed result to
 * the user's app-data folder. Both paths call the same `buildConstellationPatterns` (@solen/core)
 * so a freshly downloaded set and the bundled one are always shaped identically — the renderer
 * doesn't need to know or care which one it got.
 */
export async function downloadConstellationPatterns(userDataDir: string): Promise<ConstellationPatternData[]> {
  const [lines, names] = await Promise.all([fetchJson(LINES_URL), fetchJson(NAMES_URL)]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw GeoJSON, shape-checked inside buildConstellationPatterns
  const patterns = buildConstellationPatterns(lines as any, names as any);
  await mkdir(userDataDir, { recursive: true });
  const cache: CacheFile = { schemaVersion: CACHE_SCHEMA_VERSION, patterns };
  await writeFile(cachePath(userDataDir), JSON.stringify(cache), "utf8");
  return patterns;
}

/** Reads a previously downloaded set, or `null` if none has been cached yet (a fresh install
 * before the first download, one that's never been triggered, or — same treatment — a cache
 * written by an older, now-stale transform version; see `CACHE_SCHEMA_VERSION`). */
export async function getCachedConstellationPatterns(userDataDir: string): Promise<ConstellationPatternData[] | null> {
  try {
    const raw = await readFile(cachePath(userDataDir), "utf8");
    const cache = JSON.parse(raw) as CacheFile;
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    return cache.patterns;
  } catch {
    return null;
  }
}
