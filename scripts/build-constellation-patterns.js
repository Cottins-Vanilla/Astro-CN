#!/usr/bin/env node
// Dev-time regeneration of apps/web/src/graph3d/layouts/patterns.ts: fetches the real IAU
// constellation line-figure data from d3-celestial (https://github.com/ofrohn/d3-celestial,
// BSD-3-Clause, Copyright (c) Olaf Frohn) and re-derives it via @solen/core's
// buildConstellationPatterns (the same function apps/desktop/src/constellations.ts uses for the
// in-app "download the constellation database" feature — see docs/ARCH-CONSTELLATIONS.md) into
// patterns.ts's ConstellationPattern[] shape. Run: `node scripts/build-constellation-patterns.js`
// (requires `pnpm --filter @solen/core build` to have run first).
const fs = require("fs");
const path = require("path");
const https = require("https");
const { buildConstellationPatterns } = require("../packages/core/dist/constellationData.js");

const LINES_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json";
const NAMES_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
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

function emitPatternsTs(patterns) {
  const fmtStars = (stars) => stars.map((s) => `{ x: ${s.x}, y: ${s.y} }`).join(", ");
  const constName = (id) => id.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  const entries = patterns
    .map(
      (p) => `const ${constName(p.id)}: ConstellationPattern = {
  id: "${p.id}",
  name: "${p.name}",
  stars: [${fmtStars(p.stars)}],
  parent: [${p.parent.join(", ")}],
};`,
    )
    .join("\n\n");

  const header = `/**
 * Real IAU constellation line-figure shapes, sourced from d3-celestial
 * (https://github.com/ofrohn/d3-celestial, BSD-3-Clause License,
 * Copyright (c) Olaf Frohn) and re-derived here (see
 * scripts/build-constellation-patterns.js) into the local, normalized
 * [-1,1] coordinate frame + single spanning tree \`ConstellationLayout\`
 * expects — one star per catalog point, one parent-tree edge per drawn
 * constellation line, projected from real right-ascension/declination onto
 * a local tangent plane centered on each constellation's own centroid. A
 * constellation's official figure is sometimes drawn as several disjoint
 * line segments (a MultiLineString); only the largest connected segment is
 * kept, so every pattern here is a single tree, matching this file's
 * existing shape. See docs/CONSTELLATION.md's "Named patterns" section and
 * docs/ARCH-CONSTELLATIONS.md for the matching algorithm this data feeds.
 *
 * Regenerate with \`node scripts/build-constellation-patterns.js\` — do not hand-edit.
 */
export interface ConstellationPattern {
  /** Stable identifier, e.g. "ori" (the source data's own IAU 3-letter code, lowercased). */
  id: string;
  /** Display name shown on the constellation label. */
  name: string;
  /** Star positions in a normalized local frame, roughly centered on (0,0),
   *  coordinates in [-1, 1]. Index 0 is the pattern's anchor (highest-degree star). */
  stars: ReadonlyArray<{ x: number; y: number }>;
  /** Spanning-tree parent for each star; parent[0] === -1. Used for slot
   *  ordering and for placing overflow companion nodes. Every star reachable
   *  from 0. */
  parent: ReadonlyArray<number>;
}

`;

  const footer = `

/**
 * Every shippable pattern, sourced from real constellation data (see file header) — sorted by
 * star count ascending (asserted by the test suite) so small vaults preferentially match small
 * patterns first when scanning for candidates. See docs/CONSTELLATION.md's "Named patterns".
 */
export const PATTERNS: ConstellationPattern[] = [
${patterns.map((p) => `  ${constName(p.id)},`).join("\n")}
].sort((a, b) => a.stars.length - b.stars.length);
`;

  return header + entries + footer;
}

async function main() {
  console.log("Fetching real constellation data from d3-celestial...");
  const [lines, names] = await Promise.all([fetchJson(LINES_URL), fetchJson(NAMES_URL)]);
  const patterns = buildConstellationPatterns(lines, names);
  console.log(`Processed ${patterns.length} constellations (of ${lines.features.length} source features).`);

  const outPath = path.join(__dirname, "..", "apps", "web", "src", "graph3d", "layouts", "patterns.ts");
  fs.writeFileSync(outPath, emitPatternsTs(patterns), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
