# Constellation matching — real data, statistical fit

Constellation Mode (`docs/CONSTELLATION.md`) maps a connected cluster of notes onto
a named star-chart shape when one fits well enough, falling back to a plain BFS
asterism otherwise. This doc covers where the shapes come from and how "fits well
enough" is actually decided — replacing an earlier version that picked purely by
star count (see git history) with a real statistical match against real
astronomical data.

## Data source

`apps/web/src/graph3d/layouts/patterns.ts` is **generated, not hand-written** —
regenerate it with:

```
node scripts/build-constellation-patterns.js
```

That script fetches the real IAU constellation line-figure geometry from
[d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3-Clause, Copyright
(c) Olaf Frohn) — `constellations.lines.json` (star positions + drawn lines, in
right-ascension/declination) and `constellations.json` (names, several
languages) — and transforms them via `@solen/core`'s
`buildConstellationPatterns` into `patterns.ts`'s `ConstellationPattern[]`
shape: one entry per constellation, each a single spanning tree of stars
normalized into a local `[-1, 1]` frame.

**Naming uses the Latin/IAU form** (the source data's `la`/`name` field — e.g.
`Antlia`, `Leo`, `Ursa Maior`), not `en` (a poetic English translation of what
the constellation depicts — Antlia → "Air Pump", Leo → "Lion", Ursa Major →
"Big Dipper"). The Latin form is what's actually recognizable as a
constellation's name; the English translation isn't.

`buildConstellationPatterns` (`packages/core/src/constellationData.ts`) is the one
place this transform lives — the regeneration script and
`apps/desktop/src/constellations.ts`'s runtime "download the constellation
database" feature both call it, so a freshly downloaded dataset and the bundled
fallback are always shaped identically. Per constellation:

1. **Union graph.** A constellation's official figure is sometimes drawn as
   several disjoint line segments (a GeoJSON `MultiLineString`) — every segment's
   points and edges are merged into one graph first.
2. **Largest connected component.** Only the biggest connected piece is kept, so
   every pattern ends up a single tree (matching what `buildPatternAsterism`
   already expects) — a constellation with disconnected fragments loses the
   smaller ones. 86 of 89 source features clear the 3-star minimum (Serpens'
   official east/west split — Caput/Cauda — is disambiguated to two entries,
   `ser`/`ser-2`).
3. **Root + spanning tree.** The highest-degree star becomes index 0 (the
   pattern's "anchor," reused by `buildPatternAsterism`'s slot-ordering); a BFS
   from there produces the `parent` array.
4. **Projection.** Real right-ascension/declination is projected onto a local
   tangent plane centered on the constellation's own centroid (simple
   equirectangular projection, RA-unwrapped so a constellation straddling the
   0°/360° seam doesn't tear apart), then normalized so the largest axis fits
   `[-1, 1]`.
5. **Minimum separation.** Real constellations are often wildly unevenly scaled —
   a long straggly tail plus one small tight cluster (Draco, Hydra, Ursa Major) —
   so normalizing by the overall extent can otherwise squeeze a tight
   sub-cluster's stars closer together than is legible. A short relaxation pass
   nudges any pair closer than `0.06` apart until every pair clears it, without
   visibly distorting the rest of the shape.

## Matching: degree-sequence similarity, not size alone

`selectPattern(topology, members)` in `constellation.ts` scores **every**
pattern whose size is compatible with the cluster (never bigger than it, and
not needing more than `MAX_OVERFLOW_FRACTION` of it as unplaced "overflow
companions" — `buildPatternAsterism` fills the pattern's slots from the cluster
and only ever overflows the remainder, never the other way around) and returns
the single best match plus a confidence score in `[0, 1]`:

- **Shape**: each side's *degree sequence* (how many cluster-internal edges each
  member/star has, sorted descending) is compared rank-by-rank — a cluster
  shaped like a hub-and-spokes scores well against a pattern with the same
  branching shape, poorly against a plain chain of the same size.
- **Size**: how close the two star counts are, independent of shape.
- The two halves are averaged into one score. A cluster is only labeled with a
  pattern if the best score clears `MIN_CONFIDENCE` (0.55) — otherwise it falls
  back to the generic BFS asterism, same as a cluster no pattern fits at all.

The match confidence is a genuine, deterministic function of the cluster's own
connectivity (same topology always scores the same way; two clusters with
identical shapes but different node labels/ids get the identical match), not
a random or purely size-based pick. It's kept out of the constellation
name's own label line (`ConstellationLabel.matchPercent`, separate from
`.text`) — the renderer (`getConstellationLabelTexture`) draws it as a
smaller, dimmer second line underneath the name instead of folding it into
the name's own prominent text, so the name stays the primary read.

## Shape completion: synthetic guide lines

A cluster's *real* edges are whatever the user actually linked — they rarely
happen to trace the same star-to-star pairs as the matched constellation's
official line figure. Without help, "mapped onto Antlia" would only be
visible via star *position*, never as a connected, recognizable shape.

`buildPatternAsterism` (`constellation.ts`) compares the pattern's own
`parent`-tree edges against the real edges between the same (now-positioned)
cluster nodes; any pattern connection with no matching real edge becomes a
**synthetic edge** — collected across all of a `generate()` call's clusters
into `ConstellationLayout.syntheticEdges`. `GraphView3D.tsx` hands these to
`SceneRenderer.setSyntheticEdges`, which draws them on their own pooled
`LineSegments` (`SYNTHETIC_EDGE_OPACITY`, deliberately dimmer than a real
edge's `EDGE_BASE_OPACITY`) — never raycast, never affects Unlink/hover/pick,
purely a "this is what the constellation actually looks like" visual aid.
Hidden outside Constellation Mode, same as the name labels.

## Star size scales with degree, in every mode

`topology.ts`'s `starSize(degree)` feeds the single shared `pointsGeometry`
size attribute `SceneRenderer.setTopology` builds once per topology rebuild —
the same buffer Force and Constellation modes, 2D and 3D alike, all render
from, so a well-connected hub note reads as visibly bigger everywhere, not
just in one mode, and switching modes never makes a star "pop" to a
different size.

## Downloading a fresh copy

d3-celestial occasionally revises its data. `apps/desktop/src/constellations.ts`
exposes a runtime refresh (fetches the same two source files over HTTPS, reruns
`buildConstellationPatterns`, caches the result to the user's app-data folder) —
the renderer prefers a cached download over the bundled `patterns.ts` when one
exists, so a vault always benefits from the newest data without waiting for an
app update. See that file's own comments for the IPC surface.
