/**
 * Pure transform: real IAU constellation line-figure GeoJSON (from d3-celestial,
 * https://github.com/ofrohn/d3-celestial, BSD-3-Clause, Copyright (c) Olaf Frohn) into the
 * normalized [-1,1] local-coordinate, single-spanning-tree shape `ConstellationPattern` (see
 * apps/web/src/graph3d/layouts/patterns.ts) expects. No I/O here — callers fetch or read the two
 * source files and pass in their parsed JSON; see scripts/build-constellation-patterns.js (the
 * dev-time regeneration script, bakes `patterns.ts`) and apps/desktop/src/constellations.ts (the
 * runtime "download the constellation database" feature, see docs/ARCH-CONSTELLATIONS.md) — both
 * call this same function so the bundled fallback and a freshly downloaded set are always shaped
 * identically.
 */

export interface ConstellationPatternData {
  id: string;
  name: string;
  stars: ReadonlyArray<{ x: number; y: number }>;
  parent: ReadonlyArray<number>;
}

interface GeoJsonFeature {
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: number[][][] };
}
interface GeoJsonFeatureCollection {
  features: GeoJsonFeature[];
}

function keyOf(pt: number[]): string {
  return `${pt[0].toFixed(3)},${pt[1].toFixed(3)}`;
}

/** Minimum separation two stars must keep in the normalized [-1,1] frame — below this they'd
 * render on top of each other. Real constellations are often very unevenly scaled (a long
 * straggly tail plus one small tight cluster, e.g. Draco/Hydra/Ursa Major), so normalizing the
 * whole shape by its max extent can otherwise squeeze a tight sub-cluster's stars far closer
 * together than that. */
const MIN_STAR_SEPARATION = 0.06;

/** Nudges any pair of points closer than `MIN_STAR_SEPARATION` apart along their connecting
 * vector until every pair clears it — a handful of relaxation passes converges for the small
 * near-duplicate clusters this data produces without visibly distorting the overall shape (only
 * points that are already close move at all). Falls back to a fixed offset for exact duplicates
 * (zero-length vector, nothing to push along). */
function separateClosePoints(points: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const pts = points.map((p) => ({ ...p }));
  const n = pts.length;
  for (let pass = 0; pass < 30; pass++) {
    let movedAny = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const dist = Math.hypot(dx, dy);
        if (dist >= MIN_STAR_SEPARATION) continue;
        movedAny = true;
        const deficit = (MIN_STAR_SEPARATION - dist) / 2;
        const ux = dist > 1e-9 ? dx / dist : 1;
        const uy = dist > 1e-9 ? dy / dist : 0;
        pts[i].x -= ux * deficit;
        pts[i].y -= uy * deficit;
        pts[j].x += ux * deficit;
        pts[j].y += uy * deficit;
      }
    }
    if (!movedAny) break;
  }
  // Keep well clear of the [-1.2, 1.2] bound this data's own invariant test checks.
  for (const p of pts) {
    p.x = Math.max(-1.15, Math.min(1.15, p.x));
    p.y = Math.max(-1.15, Math.min(1.15, p.y));
  }
  return pts;
}

function processFeature(feature: GeoJsonFeature, nameById: Map<string, string>): ConstellationPatternData | null {
  const id = feature.id;
  const lineStrings = feature.geometry.coordinates;

  const pointKeyToIndex = new Map<string, number>();
  const points: number[][] = [];
  const adj = new Map<number, Set<number>>();

  function indexOf(pt: number[]): number {
    const k = keyOf(pt);
    let i = pointKeyToIndex.get(k);
    if (i === undefined) {
      i = points.length;
      pointKeyToIndex.set(k, i);
      points.push(pt);
      adj.set(i, new Set());
    }
    return i;
  }

  for (const ls of lineStrings) {
    let prev: number | null = null;
    for (const pt of ls) {
      const i = indexOf(pt);
      if (prev !== null && prev !== i) {
        adj.get(prev)!.add(i);
        adj.get(i)!.add(prev);
      }
      prev = i;
    }
  }

  // Largest connected component of the union graph — a constellation's official figure is
  // sometimes drawn as several disjoint line segments; only the largest is kept, so every pattern
  // ends up a single tree.
  const seen = new Set<number>();
  let best: number[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const comp: number[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const nb of adj.get(n)!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (best.length < 3) return null; // too small to be a meaningful pattern

  let root = best[0];
  for (const n of best) {
    const dn = adj.get(n)!.size;
    const dr = adj.get(root)!.size;
    if (dn > dr || (dn === dr && n < root)) root = n;
  }

  const compSet = new Set(best);
  const order = [root];
  const parentOfOrig = new Map<number, number>([[root, -1]]);
  const visited = new Set<number>([root]);
  for (let qi = 0; qi < order.length; qi++) {
    const cur = order[qi];
    const neighbors = [...adj.get(cur)!].filter((n) => compSet.has(n)).sort((a, b) => a - b);
    for (const nb of neighbors) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      parentOfOrig.set(nb, cur);
      order.push(nb);
    }
  }

  // Project [lon,lat] -> local tangent-plane [x,y], unwrapping RA around the component's own mean
  // so a constellation straddling the 0/360 boundary doesn't tear apart.
  const lons = order.map((i) => points[i][0]);
  const refLon = lons[0];
  const unwrapped = lons.map((lon) => {
    let d = lon - refLon;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return refLon + d;
  });
  const meanLon = unwrapped.reduce((a, b) => a + b, 0) / unwrapped.length;
  const lats = order.map((i) => points[i][1]);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);

  const xy = order.map((_origIdx, i) => ({
    x: (unwrapped[i] - meanLon) * cosLat,
    y: lats[i] - meanLat,
  }));
  const maxAbs = Math.max(1e-6, ...xy.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  const normalized = xy.map((p) => ({ x: p.x / maxAbs, y: p.y / maxAbs }));
  const stars = separateClosePoints(normalized).map((p) => ({
    x: Number(p.x.toFixed(4)),
    y: Number(p.y.toFixed(4)),
  }));

  const origToNew = new Map(order.map((origIdx, i) => [origIdx, i]));
  const parent = order.map((origIdx) => {
    const p = parentOfOrig.get(origIdx)!;
    return p === -1 ? -1 : origToNew.get(p)!;
  });

  return { id: id.toLowerCase(), name: nameById.get(id) || id, stars, parent };
}

/**
 * Transforms d3-celestial's `constellations.lines.json` (line-figure geometry) and
 * `constellations.json` (English names) into `ConstellationPattern[]`, sorted by star count
 * ascending. Serpens is officially split into two disjoint halves (Caput/Cauda) by Ophiuchus, so
 * its "Ser" id is disambiguated to "ser"/"ser-2" rather than one silently overwriting the other.
 */
export function buildConstellationPatterns(
  linesGeoJson: GeoJsonFeatureCollection,
  namesGeoJson: GeoJsonFeatureCollection,
): ConstellationPatternData[] {
  // The standard Latin/IAU name ("la"/"name" — identical in the source data), not "en" (a poetic
  // English translation: Leo → "Lion", Ursa Major → "Big Dipper", Antlia → "Air Pump") — the
  // Latin form is what's actually recognizable as a constellation name.
  const nameById = new Map(
    namesGeoJson.features.map((f) => [f.id, String(f.properties.la ?? f.properties.name ?? f.id)]),
  );

  const patterns: ConstellationPatternData[] = [];
  const idCounts = new Map<string, number>();
  for (const feature of linesGeoJson.features) {
    const p = processFeature(feature, nameById);
    if (!p) continue;
    const count = (idCounts.get(p.id) ?? 0) + 1;
    idCounts.set(p.id, count);
    if (count > 1) patterns.push({ ...p, id: `${p.id}-${count}`, name: `${p.name} (${count})` });
    else patterns.push(p);
  }
  return patterns.sort((a, b) => a.stars.length - b.stars.length);
}
