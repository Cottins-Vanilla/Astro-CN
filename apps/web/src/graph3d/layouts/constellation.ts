import { hashString, mulberry32, type GraphTopology } from "../topology";
// viewBudget, not renderer: a layout is pure CPU and must not pull three.js into its module graph
// (docs/ARCHITECTURE.md — "a layout doesn't know how it will be drawn"). These two numbers are the
// one thing both sides genuinely have to agree on, so they live in a module neither owns.
import { CAMERA_MAX_DISTANCE, FOG_FAR } from "../viewBudget";
import { PATTERNS as BUNDLED_PATTERNS, type ConstellationPattern } from "./patterns";
import type { GraphLayout } from "./types";

/** The pattern set `selectPattern` scores against — the bundled, build-time-baked set by default,
 * swappable at runtime for a freshly downloaded one (see docs/ARCH-CONSTELLATIONS.md and
 * `setActivePatterns`, called once at app startup if `window.constellationsAPI` has a cached or
 * newly downloaded set). */
let activePatterns: readonly ConstellationPattern[] = BUNDLED_PATTERNS;

/** Swaps the pattern set `selectPattern` matches against — called once at startup (see App.tsx's
 * init effect) after checking for a downloaded constellation database; never called mid-session
 * otherwise, so an in-progress Constellation Mode layout never sees patterns change under it. */
export function setActivePatterns(patterns: readonly ConstellationPattern[]): void {
  activePatterns = patterns;
}

/** The pattern set currently in effect — exported so patterns.test.ts-style invariant checks and
 * `ConstellationLayout` consumers (e.g. label-name lookups) can read whichever set is active,
 * bundled or downloaded, instead of assuming the bundled one. */
export function getActivePatterns(): readonly ConstellationPattern[] {
  return activePatterns;
}

/** A faint constellation-name label for one pattern-mapped cluster — see
 * docs/CONSTELLATION.md's "Named patterns" section. Fallback (plain BFS)
 * clusters never produce one. */
export interface ConstellationLabel {
  position: [number, number, number];
  text: string;
  /** Match confidence (see `selectPattern`'s scoring), 0-100 — kept separate from `text` so the
   * renderer can draw it smaller/dimmer in its own place instead of folding it into the name's
   * own prominent line. */
  matchPercent: number;
}

/**
 * Constellation Mode's licence to break topology (see the module doc comment below): a real vault
 * is very often ONE giant connected component, so "cluster = connected component" (the old
 * approach) always drew exactly one constellation no matter how large the vault got, and any
 * component big enough to need splitting fell back to label-propagation groups that had almost no
 * *internal* edges once oversized groups were chunked evenly by array slice — `buildAsterism`
 * could then only reach a handful of members from the alpha star, scattering the rest. `partitionGraph`
 * below replaces both: it targets a fixed, readable constellation size regardless of how (or
 * whether) the graph is actually connected, using adjacency only as a *preference* for which
 * already-unassigned node joins next, never as a hard requirement. This is the deliberate
 * topology-breaking the product spec grants Constellation Mode — Force mode's layout never calls
 * this and keeps reading the real graph exactly as edges say it is.
 *
 * Numbers: real IAU constellations mostly run 3-27 stars (see patterns.ts); 12 sits comfortably in
 * the middle of that range and reads as a clear, uncluttered shape on screen at the dome's usual
 * viewing distance. 5 is the floor below which a cluster stops looking like a "constellation" and
 * starts looking like a couple of stray dots — `mergeSmallClusters` folds anything smaller back in.
 * 24 is the hard ceiling `mergeSmallClusters` may never cross when redistributing leftovers, twice
 * the target so a merge never re-creates the old mush.
 */
const TARGET_CLUSTER_SIZE = 12;
/** Exported so constellation.test.ts can assert the "cluster sizes within the target band"
 * property against the real, live values instead of a hand-duplicated copy of these numbers. */
export const MIN_CLUSTER_SIZE = 5;
export const MAX_CLUSTER_SIZE = 24;

/** Radius of the celestial dome the clusters sit on. */
const SHELL_RADIUS = 340;
/** "depth compressed (~0.3x)" per docs/CONSTELLATION.md — flattens the dome's bulge toward the camera. */
const DEPTH_COMPRESSION = 0.3;

const RING_SPACING = 46;
const ROOT_CHILD_SPREAD = Math.PI * 2;
/** Non-root branches fan forward from their parent's incoming direction, not backward over it. */
const BRANCH_SPREAD = (100 * Math.PI) / 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Overflow companions orbit their spanning-tree parent's final spot at this radius, in pattern units. */
const COMPANION_RADIUS_MIN = 0.12;
const COMPANION_RADIUS_RANGE = 0.08;
/** Constellation name label sits this far below the cluster's local bounding box. */
const LABEL_Y_OFFSET = 30;
/** Minimum gap kept between two constellations' bounding discs (see `placeClusters`), in the same
 * local units as `RING_SPACING` — generous enough to read as separate constellations rather than a
 * hairline touch. */
const CONSTELLATION_GAP = RING_SPACING;
/** A name label's own rough footprint radius around its anchor point (matches renderer.ts's sprite
 * `scale.set(112, 38.5, 1)` — half of the larger dimension, rounded up), folded into a cluster's
 * bounding radius so two constellations' labels can never crowd each other either. */
const LABEL_FOOTPRINT_RADIUS = 60;

/**
 * The largest radius the WHOLE sky (every constellation's placement, out to its own bounding
 * radius) may reach before `generate()`'s fit-to-budget pass uniformly rescales everything down —
 * see `placeClusters`'s doc comment for why an unbounded dome is a real product bug (content that
 * is both invisible past the fog and unreachable past the camera's pull-back limit), not a
 * cosmetic one. Derived from the renderer's own real reachable envelope, not a fresh magic number
 * duplicating it — this is exactly the class of bug this file already caused once by assuming
 * `SHELL_RADIUS` and the renderer's `FOG_NEAR`/`FOG_FAR` would stay in sync via a comment alone.
 *
 * At camera pull-back distance D, a `PerspectiveCamera` with `renderer.ts`'s ~55°-vertical FOV
 * frames a radius of roughly `D * tan(27.5°)`, and a point on the dome's far side sits at
 * camera-space depth of roughly `D + radius` (the fog cutoff). Solving both for the largest radius
 * that clears each simultaneously — `D * tan(27.5°) = FOG_FAR - D` — gives the fit distance and
 * radius below; capped at `CAMERA_MAX_DISTANCE` (the pull-back hard clamp) and given a flat 10%
 * haircut since this is a frustum approximation, not exact scene geometry (labels/companions poke
 * a little past a member's own radius too).
 */
const FRUSTUM_HALF_ANGLE_TAN = Math.tan((27.5 * Math.PI) / 180);
const FIT_DISTANCE = FOG_FAR / (1 + FRUSTUM_HALF_ANGLE_TAN);
// Exported (like MIN/MAX_CLUSTER_SIZE below) so constellation.test.ts can assert the fits-in-budget
// property against the real, live value instead of a hand-duplicated copy of it.
export const DOME_RADIUS_BUDGET = Math.min(CAMERA_MAX_DISTANCE, FOG_FAR - FIT_DISTANCE) * 0.9;

/**
 * Deterministically partitions every node into constellation-sized groups, ignoring whether the
 * graph is actually one giant component or a hundred tiny ones — see this section's module-level
 * doc comment for why. Seeds are picked highest-degree-first (ties by `hashString(id)` ascending,
 * `selectAlpha`'s own tiebreak convention) so the most "important" stars anchor a region each; each
 * region then grows by repeatedly claiming whichever unassigned node adjacent to it has the
 * highest degree (same tiebreak), stopping the instant it reaches `TARGET_CLUSTER_SIZE` — a node
 * linked ever so strongly to an already-full region simply becomes some other region's problem,
 * per the product's explicit "disregard topology" licence. Nodes with no unassigned neighbor left
 * to claim (a fully-explored small component, or a lone unlinked note) become the seed of their
 * own region — possibly of size 1 — which `mergeSmallClusters` folds into a neighbor afterwards, so
 * by the time `generate()` uses the result nothing this small survives. Every node is assigned
 * exactly once: the seed loop keeps picking a new seed from whatever remains unassigned until
 * nothing does.
 */
function partitionGraph(topology: GraphTopology): number[][] {
  const n = topology.nodes.length;
  const assigned = new Int32Array(n).fill(-1);
  const clusters: number[][] = [];

  const higherPriority = (a: number, b: number): boolean =>
    topology.nodes[a].degree > topology.nodes[b].degree ||
    (topology.nodes[a].degree === topology.nodes[b].degree && hashString(topology.nodes[a].id) < hashString(topology.nodes[b].id));

  const seedOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => (higherPriority(a, b) ? -1 : higherPriority(b, a) ? 1 : 0));

  for (const seed of seedOrder) {
    if (assigned[seed] !== -1) continue;
    const clusterId = clusters.length;
    const members = [seed];
    assigned[seed] = clusterId;
    // Frontier of not-yet-assigned nodes adjacent to something already in this region. A node can
    // appear more than once (reachable from two different members already claimed) — the "already
    // assigned" check below when a duplicate is considered makes that harmless, just a wasted scan.
    let frontier = topology.neighbors[seed].filter((nb) => assigned[nb] === -1);
    while (members.length < TARGET_CLUSTER_SIZE && frontier.length > 0) {
      let bestIdx = -1;
      for (let i = 0; i < frontier.length; i++) {
        const cand = frontier[i];
        if (assigned[cand] !== -1) continue; // claimed by another duplicate frontier entry already
        if (bestIdx === -1 || higherPriority(cand, frontier[bestIdx])) bestIdx = i;
      }
      if (bestIdx === -1) break; // every remaining frontier entry turned out to be already claimed
      const next = frontier[bestIdx];
      assigned[next] = clusterId;
      members.push(next);
      frontier.splice(bestIdx, 1);
      for (const nb of topology.neighbors[next]) if (assigned[nb] === -1) frontier.push(nb);
    }
    clusters.push(members);
  }
  return clusters;
}

/**
 * Folds every cluster smaller than `MIN_CLUSTER_SIZE` into another cluster with room to spare —
 * this is the "nodes unreachable from any seed [...] distribute them into under-full
 * constellations" half of the product spec, generalized: `partitionGraph` already produces a
 * size-1 region for any node it couldn't grow past (an isolated note, or a small component fully
 * consumed), so folding those in here is enough; no separate "unreachable node" case is needed.
 * Processed smallest-first (ties by the hash of the cluster's own seed) so a chain of merges
 * compounds toward `MIN_CLUSTER_SIZE` rather than leaving several still-tiny clusters unmerged.
 * Destination preference: another cluster this one has a *real edge* into (found via `belongsTo`,
 * a node -> current-cluster lookup kept up to date as merges happen, rather than rebuilding a
 * membership Set per candidate cluster — with hundreds of clusters in a large vault, that
 * per-candidate Set was the dominant cost of a topology rebuild, quadratic in cluster count for no
 * real benefit), else whichever cluster currently has the most spare room below
 * `MAX_CLUSTER_SIZE` (so repeated merges — e.g. many isolated single-note "constellations" —
 * spread across several under-full clusters instead of all piling into the first one); either way,
 * never past `MAX_CLUSTER_SIZE`. If literally nothing has room (only possible in a vault barely
 * bigger than `MAX_CLUSTER_SIZE` to begin with), the cap is relaxed rather than leaving a node
 * behind — every node landing somewhere always wins over keeping the band tight.
 */
function mergeSmallClusters(topology: GraphTopology, clusters: number[][]): number[][] {
  if (clusters.length <= 1) return clusters;

  const alive = clusters.map((c) => c.slice());
  const removed = new Array<boolean>(clusters.length).fill(false);
  const belongsTo = new Int32Array(topology.nodes.length);
  clusters.forEach((c, i) => {
    for (const m of c) belongsTo[m] = i;
  });
  const order = clusters
    .map((_, i) => i)
    .sort((a, b) => clusters[a].length - clusters[b].length || hashString(topology.nodes[clusters[a][0]].id) - hashString(topology.nodes[clusters[b][0]].id));

  const fits = (j: number, i: number) => alive[j].length + alive[i].length <= MAX_CLUSTER_SIZE;
  const smaller = (j: number, bestJ: number, bestSize: number) =>
    alive[j].length < bestSize ||
    (alive[j].length === bestSize && hashString(topology.nodes[alive[j][0]].id) < hashString(topology.nodes[alive[bestJ][0]].id));

  for (const i of order) {
    if (removed[i] || alive[i].length >= MIN_CLUSTER_SIZE) continue;

    // Prefer a destination this cluster has a real edge into: walk cluster i's own members' real
    // neighbors and look up which (still-alive, non-self, room-to-spare) cluster each currently
    // belongs to — O(members * degree) for this one cluster, not O(every other cluster's size).
    let bestJ = -1;
    let bestSize = Infinity;
    for (const m of alive[i]) {
      for (const nb of topology.neighbors[m]) {
        const j = belongsTo[nb];
        if (j === i || removed[j] || !fits(j, i)) continue;
        if (bestJ === -1 || smaller(j, bestJ, bestSize)) {
          bestJ = j;
          bestSize = alive[j].length;
        }
      }
    }
    if (bestJ === -1) {
      // No edge-connected candidate had room (or none exists at all, e.g. an isolated note) —
      // spread into whichever live cluster currently has the most spare room.
      for (let j = 0; j < alive.length; j++) {
        if (j === i || removed[j] || !fits(j, i)) continue;
        if (bestJ === -1 || smaller(j, bestJ, bestSize)) {
          bestJ = j;
          bestSize = alive[j].length;
        }
      }
    }
    if (bestJ === -1) {
      // Nothing had room within MAX_CLUSTER_SIZE at all — relax the cap rather than strand a node.
      for (let j = 0; j < alive.length; j++) {
        if (j === i || removed[j]) continue;
        if (bestJ === -1 || alive[j].length < bestSize) {
          bestJ = j;
          bestSize = alive[j].length;
        }
      }
    }
    if (bestJ === -1) continue; // only cluster left after removals — nothing to merge into
    for (const m of alive[i]) belongsTo[m] = bestJ;
    alive[bestJ].push(...alive[i]);
    removed[i] = true;
  }
  return alive.filter((_, i) => !removed[i]);
}

interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

/** Highest-degree node in the cluster (the "alpha star"); ties broken by id hash so the pick is
 * deterministic. Shared by the BFS fallback and the named-pattern path below. */
function selectAlpha(topology: GraphTopology, members: number[]): number {
  let alpha = members[0];
  for (const m of members) {
    const better =
      topology.nodes[m].degree > topology.nodes[alpha].degree ||
      (topology.nodes[m].degree === topology.nodes[alpha].degree &&
        hashString(topology.nodes[m].id) < hashString(topology.nodes[alpha].id));
    if (better) alpha = m;
  }
  return alpha;
}

/**
 * Breadth-first asterism from the cluster's "alpha star": children fan out
 * at quasi-regular angles along gently bent polylines (each branch continues
 * roughly the direction it grew from its parent, with small id-hash-seeded
 * jitter), the classic star-chart look.
 *
 * Fallback ONLY — every cluster large enough for the smallest real pattern (3 stars) now gets
 * mapped onto one via `buildPatternAsterism` instead (see `selectPattern`'s doc comment: there is
 * no confidence floor any more, so "too small" is the only way a real pattern doesn't apply). In
 * practice that leaves this function reachable for two cases: a whole vault of 1-2 notes (the only
 * cluster size `MAX_OVERFLOW_FRACTION`'s gate can't clear against ANY pattern), or `activePatterns`
 * being empty (a data-loading edge case / explicit test override — see `setActivePatterns`). Both
 * are degenerate by construction, not a shape judgment call the way "too lopsided" used to be.
 */
function buildAsterism(topology: GraphTopology, members: number[], alpha: number, out: Map<number, LocalPoint>): void {
  const memberSet = new Set(members);

  const visited = new Set<number>([alpha]);
  out.set(alpha, { x: 0, y: 0, z: 0 });

  interface QueueItem {
    node: number;
    angle: number;
    depth: number;
  }
  const queue: QueueItem[] = [{ node: alpha, angle: 0, depth: 0 }];
  for (let qi = 0; qi < queue.length; qi++) {
    const { node, angle, depth } = queue[qi];
    const children = topology.neighbors[node].filter((nb) => memberSet.has(nb) && !visited.has(nb));
    if (children.length === 0) continue;

    const spread = depth === 0 ? ROOT_CHILD_SPREAD : BRANCH_SPREAD;
    const start = depth === 0 ? 0 : angle - spread / 2;
    const parent = out.get(node)!;

    children.forEach((child, i) => {
      visited.add(child);
      const rnd = mulberry32(hashString(topology.nodes[child].id));
      const slot = children.length === 1 ? 0.5 : i / (children.length - 1);
      const childAngle = start + slot * spread + (rnd() - 0.5) * 0.35;
      const radius = (depth + 1) * RING_SPACING * (0.85 + rnd() * 0.3);
      out.set(child, {
        x: parent.x + Math.cos(childAngle) * radius,
        y: parent.y + Math.sin(childAngle) * radius,
        z: (rnd() - 0.5) * 14,
      });
      queue.push({ node: child, angle: childAngle, depth: depth + 1 });
    });
  }

  // mergeSmallClusters can fold a whole separate (disconnected) small cluster into this one, so a
  // member here may share no edge path back to alpha at all — see `placeStrayFragments`, which
  // gives each such leftover fragment its own properly-spread mini-asterism instead of the old
  // fixed-radius orbit around alpha (sized for a straggler or two, not a whole second cluster's
  // worth of stars sharing one anchor — see that function's own doc comment for the pile-up this
  // caused and measured).
  placeStrayFragments(topology, members, out);
}

/** The real constellation `selectPattern` chose to draw a cluster as, and how closely the
 * cluster's OWN connectivity happened to agree with that figure's — see `selectPattern`. */
export interface PatternMatch {
  pattern: ConstellationPattern;
  /** Degree-sequence agreement in [0, 1] between the cluster and the chosen pattern — shown to the
   * user as a percentage (see `generate()`'s label text). Every cluster large enough for any
   * pattern gets mapped onto one regardless of this number (see `selectPattern`'s doc comment), so
   * a low score is honest information ("this figure was the best fit available, but this cluster's
   * own shape doesn't really resemble it") rather than a gate that filtered the cluster out. */
  score: number;
}

/** A cluster only snaps onto a named pattern if it doesn't need more than this fraction of
 * overflow "companion" stars beyond the pattern's own slot count (`buildPatternAsterism` only
 * ever fills a pattern's slots from the cluster and overflows the *remainder* as companions — a
 * pattern bigger than the cluster has no slot to put a missing star in, so this is a hard cap, not
 * just a scoring preference). This is the ONLY thing that can still leave a cluster unmapped: with
 * `MIN_CLUSTER_SIZE` = 5 and the smallest real pattern at 3 stars, every cluster this partition can
 * ever produce clears this gate against at least one pattern (verified against the full bundled set:
 * every cluster size 5-24 has a candidate) — the sole clusters that legitimately fall back are ones
 * smaller than any pattern, which only happens for a whole vault of 1-2 notes (see `generate()`'s
 * doc comment and `buildAsterism`'s).
 */
const MAX_OVERFLOW_FRACTION = 0.5;

/** A cluster's degree sequence (each member's edge count *within this cluster only* — not its raw
 * topology-wide degree, which would overcount for a label-propagation-split sub-cluster), sorted
 * descending so it can be compared shape-for-shape against a pattern's, independent of node order.
 * A pair connected by both a wiki-link and a canvas edge counts once (`neighbors` can list a
 * neighbor twice; `buildPatternAsterism` already dedupes for the same reason). */
function clusterDegreeSequence(topology: GraphTopology, members: number[]): number[] {
  const memberSet = new Set(members);
  return members
    .map((m) => new Set(topology.neighbors[m].filter((nb) => memberSet.has(nb))).size)
    .sort((a, b) => b - a);
}

/** A pattern's degree sequence, derived from its spanning tree (`parent`) — cached per pattern
 * object (patterns are static data, swapped wholesale by `setActivePatterns` rather than mutated,
 * so identity-keyed caching is safe). `selectPattern` now runs once per CONSTELLATION rather than
 * once per topology rebuild (a vault of thousands of notes can produce hundreds of them, see
 * `partitionGraph`'s doc comment for why there are many more constellations than there used to
 * be), so recomputing all ~86 patterns' sequences from scratch on every single call — fine when
 * there was only ever one or two per rebuild — is worth skipping now. */
const patternDegreeSequenceCache = new WeakMap<ConstellationPattern, number[]>();
function patternDegreeSequence(pattern: ConstellationPattern): number[] {
  const cached = patternDegreeSequenceCache.get(pattern);
  if (cached) return cached;
  const deg = new Array(pattern.stars.length).fill(0);
  pattern.parent.forEach((p, i) => {
    if (p >= 0) {
      deg[p]++;
      deg[i]++;
    }
  });
  deg.sort((a, b) => b - a);
  patternDegreeSequenceCache.set(pattern, deg);
  return deg;
}

/** How alike two degree sequences' SHAPES are, in [0, 1]: branchiness at each rank, once both are
 * sorted descending, comparing element-by-element with the shorter sequence zero-padded (so a
 * genuine size gap still costs something here too, through the padding — an 8-star pattern
 * compared against a 4-star cluster picks up four extra nonzero-vs-zero terms — without a second,
 * explicit size term double-counting it on top).
 *
 * This used to also return `0.5 * shapeSim + 0.5 * sizeSim`, an explicit size-closeness term
 * blended in alongside shape. Size compatibility is already handled elsewhere — a hard GATE in
 * `selectPattern` (a pattern can never be bigger than the cluster, and overflow is capped by
 * `MAX_OVERFLOW_FRACTION`) and, among gate-passing candidates, a soft ranking preference (see
 * `SIZE_PREFERENCE_WEIGHT`) — so folding it into the SCORE too would double-count it and, worse,
 * corrupt the one thing `PatternMatch.score` is supposed to mean: how much this cluster's
 * connectivity actually looks like the named figure it got mapped onto, independent of why that
 * figure was picked. */
function degreeSequenceSimilarity(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let diff = 0;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    diff += Math.abs(av - bv);
    scale += av + bv;
  }
  return scale === 0 ? 1 : 1 - diff / scale;
}

/**
 * How strongly `selectPattern` prefers a size-close pattern over a strictly higher-scoring but
 * much-smaller one, when ranking candidates (never applied to the returned/displayed `score` — see
 * `PatternMatch`'s doc comment). Weighted against `overflowFraction` (companions ÷ cluster size,
 * i.e. the share of the cluster that ends up NOT in a real pattern slot): every real 86-pattern
 * vault-scale check run against this file's own test fixtures showed the same failure shape — a
 * much-smaller pattern occasionally out-scored a same-size-ish one by a couple of points while
 * leaving 3-4x as many members as unslotted companions (e.g. a 24-member cluster: a 20-star pattern
 * scoring 0.818 with 4 companions beat a 23-star pattern scoring 0.809 with just 1, a companion
 * count nobody asked this metric to trade away for such a small score gap). 0.2 is the smallest
 * weight that flips exactly that class of case (a ~1pt score edge against a >10pp overflow-fraction
 * gap) while leaving a genuinely better-shaped smaller pattern's OWN already-zero-overflow pick
 * alone (this term can only ever penalize a candidate, never boost one past a lower-overflow rival
 * that was already tied or ahead on shape).
 */
const SIZE_PREFERENCE_WEIGHT = 0.2;

/**
 * Picks the real constellation whose actual line-figure shape (see docs/ARCH-CONSTELLATIONS.md —
 * data sourced from d3-celestial, not hand-guessed) best matches this cluster's own connectivity,
 * by comparing degree sequences: every pattern within size range is scored, and the pattern with
 * the best RANK (shape score, softly preferring less overflow — see `SIZE_PREFERENCE_WEIGHT`) wins
 * outright, e.g. "this cluster is 74% Ursa Major, 51% Libra — Ursa Major wins." Every cluster gets
 * mapped onto SOME pattern this way — there is no confidence floor any more (see `MAX_OVERFLOW_
 * FRACTION`'s doc comment for why a real vault's clusters essentially always clear the one hard
 * gate that remains); a low `score` is shown to the user as-is rather than hidden behind a
 * fallback, because "how well this cluster's shape agrees with the figure it was drawn as" is
 * useful information at any value, not just above some bar. `null` only when literally no pattern
 * is small enough to fit inside the cluster at all — the caller falls back to the plain BFS
 * asterism for that case. Exported for unit testing only — GraphLayout consumers use `generate()`.
 */
export function selectPattern(topology: GraphTopology, members: number[]): PatternMatch | null {
  const clusterDeg = clusterDegreeSequence(topology, members);
  let best: ConstellationPattern | null = null;
  let bestScore = -1;
  let bestRank = -Infinity;
  for (const pattern of activePatterns) {
    // buildPatternAsterism fills the pattern's slots from cluster members and overflows any
    // remainder as companions — never the other way around — so a pattern bigger than the
    // cluster, or one needing more overflow than MAX_OVERFLOW_FRACTION allows, is never a
    // candidate at all, regardless of how well its shape might otherwise score.
    if (pattern.stars.length > members.length) continue;
    const overflow = members.length - pattern.stars.length;
    if (overflow > Math.ceil(pattern.stars.length * MAX_OVERFLOW_FRACTION)) continue;
    const score = degreeSequenceSimilarity(clusterDeg, patternDegreeSequence(pattern));
    const rank = score - SIZE_PREFERENCE_WEIGHT * (overflow / members.length);
    if (rank > bestRank) {
      bestRank = rank;
      bestScore = score;
      best = pattern;
    }
  }
  if (!best) return null;
  return { pattern: best, score: bestScore };
}

/**
 * Picks a figure for every cluster at once, using each named constellation **at most once**.
 *
 * `selectPattern` answers "which figure best fits this one cluster", and answering it separately
 * per cluster is what produced a sky that was mostly the same constellation over and over: on a
 * real 364-note vault, 40 clusters drew only 11 distinct figures, twenty of them Cancer. That is
 * not a scoring bug — clusters here are deliberately built to a uniform target size, so they have
 * genuinely similar degree sequences and genuinely agree on which figure fits best. The fix is to
 * treat it as an assignment problem instead of 40 independent questions.
 *
 * Greedy over every (cluster, figure) pair by score, best first: the strongest single agreement in
 * the whole sky is honoured first, then the next, each claiming its cluster and its figure. Ties
 * break on cluster index then figure name so the same vault always draws the same sky. Not optimal
 * in the total-score sense (that would be the Hungarian algorithm on an 86-column matrix), but it
 * never gives two clusters the same name while a spare figure exists, which is the property that
 * was actually missing.
 *
 * With more clusters than figures the last ones must repeat: a second pass then lets them take
 * their own best match, since a repeated name beats no figure at all.
 */
function assignPatterns(topology: GraphTopology, clusters: number[][]): Array<PatternMatch | null> {
  interface Candidate {
    ci: number;
    pattern: ConstellationPattern;
    score: number;
    rank: number;
  }
  const candidates: Candidate[] = [];
  clusters.forEach((members, ci) => {
    const clusterDeg = clusterDegreeSequence(topology, members);
    for (const pattern of activePatterns) {
      if (pattern.stars.length > members.length) continue;
      const overflow = members.length - pattern.stars.length;
      if (overflow > Math.ceil(pattern.stars.length * MAX_OVERFLOW_FRACTION)) continue;
      const score = degreeSequenceSimilarity(clusterDeg, patternDegreeSequence(pattern));
      candidates.push({ ci, pattern, score, rank: score - SIZE_PREFERENCE_WEIGHT * (overflow / members.length) });
    }
  });
  candidates.sort((a, b) => b.rank - a.rank || a.ci - b.ci || a.pattern.name.localeCompare(b.pattern.name));

  const assigned: Array<PatternMatch | null> = clusters.map(() => null);
  const usedNames = new Set<string>();
  for (const c of candidates) {
    if (assigned[c.ci] || usedNames.has(c.pattern.name)) continue;
    assigned[c.ci] = { pattern: c.pattern, score: c.score };
    usedNames.add(c.pattern.name);
  }
  for (let ci = 0; ci < clusters.length; ci++) {
    if (!assigned[ci]) assigned[ci] = selectPattern(topology, clusters[ci]);
  }
  return assigned;
}

/**
 * Maps a cluster onto a hand-authored `pattern`: cluster nodes are ordered
 * by DFS preorder of the cluster's own BFS spanning tree from `alpha`
 * (children sorted by degree desc, then id hash asc) and zipped one-to-one
 * against the pattern's slots, themselves DFS-ordered from the pattern's
 * `parent` tree — so graph edges that follow the spanning tree tend to run
 * along the drawn shape, and the cluster reads as the named constellation.
 * Overflow nodes (cluster bigger than the pattern) become "companion" stars
 * orbiting their own spanning-tree parent's final position. Returns the
 * pattern's name and the cluster's local bounding box, for the caller to
 * place a name label under it.
 */
function buildPatternAsterism(
  topology: GraphTopology,
  members: number[],
  alpha: number,
  pattern: ConstellationPattern,
  out: Map<number, LocalPoint>,
): { patternName: string; bboxMinX: number; bboxMaxX: number; bboxMinY: number; syntheticEdges: Array<[number, number]>; figureEdges: Array<[number, number]> } {
  const memberSet = new Set(members);

  // BFS spanning tree from alpha; children sorted so higher-degree branches claim earlier
  // (more "prominent") pattern slots first.
  const childrenOf = new Map<number, number[]>();
  const parentOf = new Map<number, number>();
  const visited = new Set<number>([alpha]);
  const bfsQueue = [alpha];
  for (let qi = 0; qi < bfsQueue.length; qi++) {
    const node = bfsQueue[qi];
    // Dedupe: two nodes can share more than one edge (e.g. a wikilink and a canvas structural
    // link both connecting the same pair), which would otherwise double-queue a neighbor and
    // corrupt the one-slot-per-node preorder below.
    const kids = [...new Set(topology.neighbors[node].filter((nb) => memberSet.has(nb) && !visited.has(nb)))];
    kids.sort(
      (a, b) =>
        topology.nodes[b].degree - topology.nodes[a].degree ||
        hashString(topology.nodes[a].id) - hashString(topology.nodes[b].id),
    );
    childrenOf.set(node, kids);
    for (const kid of kids) {
      visited.add(kid);
      parentOf.set(kid, node);
      bfsQueue.push(kid);
    }
  }

  // DFS preorder of the cluster's spanning tree, respecting childrenOf's sorted order.
  const clusterOrder: number[] = [];
  const dfsStack: number[] = [alpha];
  while (dfsStack.length > 0) {
    const node = dfsStack.pop()!;
    clusterOrder.push(node);
    const kids = childrenOf.get(node) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) dfsStack.push(kids[i]);
  }
  // mergeSmallClusters can fold in a whole separate (disconnected) small cluster, leaving some
  // members unreachable from alpha's own tree; tack any such stragglers on the end so every member
  // still gets placed (as overflow companions).
  for (const m of members) if (!visited.has(m)) clusterOrder.push(m);

  // DFS preorder of the pattern's own parent tree, children visited in index order.
  const patternChildren: number[][] = pattern.stars.map(() => []);
  pattern.parent.forEach((p, i) => {
    if (p >= 0) patternChildren[p].push(i);
  });
  const slotOrder: number[] = [];
  const slotStack: number[] = [0];
  while (slotStack.length > 0) {
    const i = slotStack.pop()!;
    slotOrder.push(i);
    const kids = patternChildren[i];
    for (let k = kids.length - 1; k >= 0; k--) slotStack.push(kids[k]);
  }
  const nSlots = slotOrder.length;

  const scale = RING_SPACING * (1.1 + 0.22 * Math.sqrt(nSlots));
  const slotLocal = new Map<number, LocalPoint>();
  for (let i = 0; i < nSlots; i++) {
    const star = pattern.stars[slotOrder[i]];
    const rnd = mulberry32(hashString(topology.nodes[clusterOrder[i]].id));
    slotLocal.set(slotOrder[i], { x: star.x * scale, y: star.y * scale, z: (rnd() - 0.5) * 14 });
  }
  for (let i = 0; i < nSlots; i++) out.set(clusterOrder[i], slotLocal.get(slotOrder[i])!);

  // The real graph's own edges rarely happen to trace the same pairs as the constellation's
  // official line figure (the cluster's connectivity is whatever the user actually linked, not
  // astronomy) — without this, "mapped onto Antlia" would only be visible via star *position*,
  // never as a recognizable connected shape. So: every edge the pattern itself draws (its own
  // `parent` tree) that ISN'T already a real edge between the same two (now-positioned) cluster
  // nodes becomes a synthetic edge, rendered dimmer/non-interactive — see renderer.ts's
  // `setSyntheticEdges`. Real edges always take precedence; this only fills gaps.
  const nodeForSlot = new Array<number>(nSlots);
  for (let i = 0; i < nSlots; i++) nodeForSlot[slotOrder[i]] = clusterOrder[i];
  const syntheticEdges: Array<[number, number]> = [];
  // The other half of the same problem: a real edge the figure does NOT draw is still rendered, and
  // a dozen of those crossing a constellation turn it back into a scribble — measured on a real
  // vault, where Orion's own lines were unreadable under the cluster's unrelated internal links.
  // So the figure's own pairs are collected here too, and the renderer draws THOSE at full strength
  // while a same-cluster edge that isn't part of the figure is merely faint (see
  // `setConstellationEmphasis`). The link is still shown — this mode may disregard the graph, but
  // it doesn't have to throw the information away to be legible.
  const figureEdges: Array<[number, number]> = [];
  for (let s = 0; s < nSlots; s++) {
    const parentSlot = pattern.parent[s];
    if (parentSlot < 0) continue;
    const nodeA = nodeForSlot[s];
    const nodeB = nodeForSlot[parentSlot];
    figureEdges.push([nodeA, nodeB]);
    const alreadyConnected = topology.neighbors[nodeA].includes(nodeB);
    if (!alreadyConnected) syntheticEdges.push([nodeA, nodeB]);
  }

  // Overflow: cluster bigger than the pattern — companions orbit their own spanning-tree
  // parent's already-placed spot (parents always precede children in the preorder above, so
  // the parent's position is guaranteed to exist by the time we get here).
  for (let i = nSlots; i < clusterOrder.length; i++) {
    const node = clusterOrder[i];
    const parent = parentOf.get(node);
    const anchor = (parent !== undefined ? out.get(parent) : out.get(alpha)) ?? { x: 0, y: 0, z: 0 };
    const rnd = mulberry32(hashString(topology.nodes[node].id));
    const angle = rnd() * Math.PI * 2;
    const radius = (COMPANION_RADIUS_MIN + rnd() * COMPANION_RADIUS_RANGE) * scale;
    out.set(node, {
      x: anchor.x + Math.cos(angle) * radius,
      y: anchor.y + Math.sin(angle) * radius,
      z: (rnd() - 0.5) * 14,
    });
  }

  let bboxMinX = Infinity;
  let bboxMaxX = -Infinity;
  let bboxMinY = Infinity;
  for (const m of members) {
    const p = out.get(m)!;
    if (p.x < bboxMinX) bboxMinX = p.x;
    if (p.x > bboxMaxX) bboxMaxX = p.x;
    if (p.y < bboxMinY) bboxMinY = p.y;
  }
  return { patternName: pattern.name, bboxMinX, bboxMaxX, bboxMinY, syntheticEdges, figureEdges };
}

/** A cluster's local-space "footprint" radius: the farthest any member (or, for a pattern-mapped
 * cluster, its name label's own anchor point plus a little padding for the label's own footprint)
 * sits from the cluster's local origin — see `buildAsterism`/`buildPatternAsterism`, which both
 * always place the alpha star at local (0, 0). Used by `placeClusters` to size the no-overlap gap
 * between two constellations, so a big or heavily-labelled cluster gets proportionally more room
 * than a small one instead of every cluster reserving the same fixed berth regardless of size. */
function localBoundingRadius(members: number[], local: Map<number, LocalPoint>, labelX: number | null, labelY: number | null): number {
  let r = 0;
  for (const m of members) {
    const p = local.get(m)!;
    const d = Math.hypot(p.x, p.y);
    if (d > r) r = d;
  }
  if (labelX !== null && labelY !== null) {
    const d = Math.hypot(labelX, labelY) + LABEL_FOOTPRINT_RADIUS;
    if (d > r) r = d;
  }
  return r;
}

/** Order-independent key for an undirected node pair, so a figure edge stored as (a,b) still
 * matches a real edge stored as (b,a). Node indices are well under 2^16 in any plausible vault
 * (the renderer's own buffers would give out long before), so packing them into one integer keeps
 * the lookup a plain numeric `Set.has` in the renderer's per-edge loop. */
export function figureEdgeKey(a: number, b: number): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}

/** One constellation's placement on the dome, ahead of z-depth — see `placeClusters`. */
interface ClusterPlacement {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * Places every cluster's center on the golden-angle sunflower spiral, at the SMALLEST radius along
 * its own ray that still clears every already-placed cluster's disc by `CONSTELLATION_GAP`.
 *
 * An earlier version of this function instead accumulated the radial step from consecutive
 * clusters' own radii (`r[i] = r[i-1] + radius[i-1] + radius[i] + GAP`) — provably non-overlapping
 * (by the reverse triangle inequality: two points at radii `r[i]`/`r[j]` from a shared origin are
 * always at least `|r[i] - r[j]|` apart, regardless of angle), but wasteful: that radius grows
 * LINEARLY with cluster count, so the area consumed grows as count², while only `count` clusters
 * are actually being placed — a large vault's sky quickly outgrew the camera's reachable envelope
 * entirely (see `DOME_RADIUS_BUDGET`'s doc comment). This version packs close to as tightly as a
 * true Vogel spiral while keeping an exact, per-pair guarantee instead of relying on radial
 * separation alone to do the work.
 *
 * For each already-placed cluster j and the new cluster's ray (unit vector `u` at angle
 * `ci * GOLDEN_ANGLE`), the minimal `r >= 0` with `|r*u - c_j| >= radius_i + radius_j + GAP` is the
 * larger root of `r^2 - 2r*(u·c_j) + |c_j|^2 - need^2 = 0` (plain ray/circle intersection) when
 * that root is positive. The parabola in `r` opens upward, so once `r` clears that root, distance
 * to `c_j` only keeps growing — meaning the single largest such `r` across every already-placed
 * cluster is simultaneously safe against ALL of them, not just whichever one produced it. Cost:
 * O(count) work per new cluster against every one placed so far, O(count²) total — trivial next to
 * `mergeSmallClusters`'s own bound at the cluster counts this ever reaches in practice (a few
 * thousand, worst case).
 *
 * This alone still doesn't cap how big the sky gets for a big enough vault (sqrt growth is slower
 * than linear, but still unbounded) — `generate()`'s fit-to-budget pass after this call is what
 * actually guarantees the result fits in view; see `DOME_RADIUS_BUDGET`.
 */
function placeClusters(radii: number[]): ClusterPlacement[] {
  const placements: ClusterPlacement[] = [];
  for (let ci = 0; ci < radii.length; ci++) {
    const theta = ci * GOLDEN_ANGLE;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    let r = 0;
    for (const p of placements) {
      const need = radii[ci] + p.radius + CONSTELLATION_GAP;
      const dot = ux * p.cx + uy * p.cy;
      const discriminant = dot * dot - (p.cx * p.cx + p.cy * p.cy - need * need);
      if (discriminant <= 0) continue; // this ray never enters p's exclusion disc at any radius
      const candidate = dot + Math.sqrt(discriminant);
      if (candidate > r) r = candidate;
    }
    placements.push({ cx: r * ux, cy: r * uy, radius: radii[ci] });
  }
  return placements;
}

/**
 * Spreads whatever `buildAsterism` (or a recursive call from right here) couldn't reach from its
 * alpha star into its own well-separated mini-constellation(s), instead of the old fixed-radius
 * "companion" orbit around alpha.
 *
 * Reachability note: `buildAsterism` (this function's only caller) is now itself reachable only for
 * a whole vault of 1-2 notes or an empty `activePatterns` — see `buildAsterism`'s own doc comment.
 * The scenario the rest of this comment walks through (an 8-star cluster made of two merged,
 * mutually-disconnected 4-star pieces) is real history — it's exactly what motivated this function
 * — but that specific cluster no longer reaches this code path in production: at 8 members it now
 * clears `selectPattern`'s size gate and gets mapped onto a real 8-star pattern via
 * `buildPatternAsterism` instead, whose own "stragglers appended to the DFS order" handling is a
 * different (slot-filling, not fragment-packing) fix for the same underlying disconnection. The
 * test covering the scenario below (`constellation.test.ts`'s "spreads a mergeSmallClusters-merged
 * [...] cluster's stars apart") forces `setActivePatterns([])` specifically to keep exercising this
 * path once patterns started swallowing every size-viable cluster.
 *
 * That old approach was sized for what `buildPatternAsterism`'s overflow case actually is — a
 * handful of extra stars beyond a pattern's slot count, each orbiting its OWN spanning-tree parent
 * at a small radius, which stays readable because there are few of them and they scatter across
 * several different parent points. `buildAsterism`'s leftover case is a different animal:
 * `mergeSmallClusters` can glue an ENTIRE disconnected small cluster onto this one (not a
 * straggler — a whole other constellation's worth of stars, still connected among themselves, just
 * not to alpha's own piece), and the old code put every single one of them in the same
 * COMPANION_RADIUS_MIN/RANGE band around the SAME anchor regardless of how many there were —
 * confirmed by measurement, not assumption: for an 8-star cluster made of two disconnected 4-star
 * pieces (both below MIN_CLUSTER_SIZE, merged by `mergeSmallClusters` with no edge between them),
 * every member of the unreached piece landed inside a disc of radius ~10-16 units — smaller than a
 * single label's own footprint (`LABEL_FOOTPRINT_RADIUS` = 60) — while the reached piece spread
 * across multiple `RING_SPACING` = 46-unit rings. That is the pile-up: not merely "close together"
 * but packed tighter than the space one star's name needs, no matter how many vault sizes or
 * layouts were tried, because the radius band barely grows (only by `sqrt(members.length)`) while
 * the star COUNT sharing it doesn't shrink.
 *
 * Fix: treat each unreached fragment as what it actually is — its own little constellation. Group
 * the leftovers into connected components using the same neighbor-filtered-to-membership rule the
 * main BFS uses (a merged-in fragment is normally still connected to ITSELF, just not to the piece
 * alpha grew from); give each fragment a full recursive `buildAsterism` pass of its own (this
 * recursion is guaranteed to bottom out one level down — a fragment is a whole connected component
 * by construction, so its own recursive call reaches every one of its members and never re-enters
 * this function); then pack every fragment's local origin — and the space alpha's own piece already
 * occupies — using the exact same provably-non-overlapping golden-spiral packer `placeClusters`
 * already uses one level up, at the sky-of-constellations scale. A merged cluster's second (or
 * third) piece ends up spread out exactly like any other constellation would be against its
 * neighbors, not squeezed into a bespoke, undersized radius band.
 */
function placeStrayFragments(topology: GraphTopology, members: number[], out: Map<number, LocalPoint>): void {
  // `out` is ONE shared map threaded through every cluster's asterism call in `generate()`'s loop
  // (node indices are globally unique, so there's never a collision) — so "already placed" must be
  // scoped to THIS cluster's own `members`, never `out.keys()` wholesale, which would otherwise pull
  // in every earlier cluster's already-finished nodes as if they were part of this one's footprint.
  const alreadyPlaced = members.filter((m) => out.has(m));
  const remaining = members.filter((m) => !out.has(m));
  if (remaining.length === 0) return;

  // Connected components among the leftovers only (mirrors buildAsterism's own membership filter,
  // restricted further to "not already placed" so this never re-walks alpha's own piece).
  const remainingSet = new Set(remaining);
  const seen = new Set<number>();
  const fragments: number[][] = [];
  for (const start of remaining) {
    if (seen.has(start)) continue;
    const frag = [start];
    seen.add(start);
    for (let qi = 0; qi < frag.length; qi++) {
      for (const nb of topology.neighbors[frag[qi]]) {
        if (!remainingSet.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        frag.push(nb);
      }
    }
    fragments.push(frag);
  }
  // Deterministic regardless of `members`'/`remaining`'s own iteration order — same id-hash
  // tiebreak convention used everywhere else in this file.
  fragments.sort((a, b) => hashString(topology.nodes[a[0]].id) - hashString(topology.nodes[b[0]].id));

  // Slot 0 in the packer below reserves the space alpha's own piece (already in `out`, anchored at
  // local origin per buildAsterism's own invariant) already occupies, so fragments pack around it
  // rather than on top of it; `placeClusters`'s first slot is always (0,0), which matches exactly.
  const existingRadius = localBoundingRadius(alreadyPlaced, out, null, null);
  const fragLocals: Array<Map<number, LocalPoint>> = [];
  const radii = [existingRadius];
  for (const frag of fragments) {
    const local = new Map<number, LocalPoint>();
    buildAsterism(topology, frag, selectAlpha(topology, frag), local);
    fragLocals.push(local);
    radii.push(localBoundingRadius(frag, local, null, null));
  }
  const placements = placeClusters(radii);
  fragments.forEach((frag, i) => {
    const { cx, cy } = placements[i + 1];
    const local = fragLocals[i];
    for (const m of frag) {
      const p = local.get(m)!;
      out.set(m, { x: cx + p.x, y: cy + p.y, z: p.z });
    }
  });
}

/**
 * Re-lays-out the same nodes and edges as a star chart: the graph is partitioned into
 * constellation-sized groups (`partitionGraph`/`mergeSmallClusters` — graph-informed, not
 * graph-constrained; see their own doc comments for the topology-breaking this mode is explicitly
 * allowed), each mapped onto a real named pattern (`selectPattern` always picks the best-fitting
 * one — no confidence floor, see its own doc comment; the plain BFS asterism is only reached for a
 * cluster too small for even the smallest pattern, which in practice means a whole vault of 1-2
 * notes), and constellations are packed without overlap across a shallow spherical shell facing the
 * camera — then uniformly scaled, if needed, so the whole sky still fits inside
 * `DOME_RADIUS_BUDGET` (the camera/fog envelope the user can actually reach), however many
 * constellations a big vault produces. Pure function of the topology — same vault always draws
 * the same sky. See docs/CONSTELLATION.md.
 */
export class ConstellationLayout implements GraphLayout {
  readonly id = "constellation";

  /** Constellation-name labels for this generate() call's pattern-mapped clusters (fallback BFS
   * clusters contribute none). Read by GraphView3D after generate() and handed to the renderer —
   * see docs/CONSTELLATION.md's "Named patterns" section. */
  labels: ConstellationLabel[] = [];

  /** Every node pair the drawn figures connect, `figureEdgeKey`-encoded — synthetic ones and the
   * real edges that happen to coincide alike. The renderer draws a real edge on this list at full
   * strength and any other same-constellation edge faintly, so a figure stays legible under a
   * cluster's unrelated internal links instead of disappearing into them. */
  figureEdgeKeys: Set<number> = new Set();

  /** Node-index pairs for this generate() call's pattern-mapped clusters where the pattern's own
   * line figure draws a connection but the real graph doesn't — drawn dimmer/non-interactive by
   * the renderer so a mapped cluster reads as its constellation's actual shape, not just
   * correctly-positioned dots. See `buildPatternAsterism`'s own comment for why. */
  syntheticEdges: Array<[number, number]> = [];

  /** Node index -> which constellation (index into this call's cluster list) it landed in — the
   * renderer uses this to brighten a link between two stars of the SAME constellation more than one
   * crossing between two different ones (see `SceneRenderer.setConstellationEmphasis`). Empty
   * outside Constellation Mode; GraphView3D only reads it right after a constellation `generate()`. */
  clusterOf: Int32Array = new Int32Array(0);

  /** Each constellation's placed center + local bounding radius this call, AFTER the fit-to-budget
   * scale (matches the positions actually written into `out`) — exposed mainly so tests can assert
   * the no-overlap and fits-in-budget guarantees directly, without reverse-engineering them from
   * raw node positions. */
  clusterBounds: ClusterPlacement[] = [];

  generate(topology: GraphTopology, _current: Float32Array, out: Float32Array): void {
    const n = topology.nodes.length;
    if (n === 0) {
      this.labels = [];
      this.syntheticEdges = [];
      this.clusterOf = new Int32Array(0);
      this.clusterBounds = [];
      return;
    }

    const clusters = mergeSmallClusters(topology, partitionGraph(topology));
    // Deterministic ordering so cluster placement on the dome doesn't depend on Map/Set iteration
    // order — same tiebreak convention as everywhere else in this file (hash of a representative
    // member's id; a cluster's own first member is always its seed, the highest-degree node it grew
    // from, so this is stable across a merge that only ever appends onto the front cluster's array).
    clusters.sort((a, b) => hashString(topology.nodes[a[0]].id) - hashString(topology.nodes[b[0]].id));

    const local = new Map<number, LocalPoint>();
    const clusterMeta: Array<
      | { patternName: string; score: number; bboxMinX: number; bboxMaxX: number; bboxMinY: number; syntheticEdges: Array<[number, number]>; figureEdges: Array<[number, number]> }
      | null
    > = [];
    // Assigned for the whole sky at once, so two constellations never share a name while an unused
    // figure is still available — see `assignPatterns`.
    const matches = assignPatterns(topology, clusters);
    for (const [ci, cluster] of clusters.entries()) {
      const alpha = selectAlpha(topology, cluster);
      const match = matches[ci];
      if (match) {
        const meta = buildPatternAsterism(topology, cluster, alpha, match.pattern, local);
        clusterMeta.push({ ...meta, score: match.score });
      } else {
        buildAsterism(topology, cluster, alpha, local);
        clusterMeta.push(null);
      }
    }
    this.syntheticEdges = clusterMeta.flatMap((meta) => meta?.syntheticEdges ?? []);
    // Keyed low-high so the renderer can look up an edge without caring which way round it stored
    // its endpoints. See `figureEdgeKey`.
    this.figureEdgeKeys = new Set(
      clusterMeta.flatMap((meta) => (meta?.figureEdges ?? []).map(([a, b]) => figureEdgeKey(a, b))),
    );

    const radii = clusters.map((cluster, ci) => {
      const meta = clusterMeta[ci];
      const labelX = meta ? (meta.bboxMinX + meta.bboxMaxX) / 2 : null;
      const labelY = meta ? meta.bboxMinY - LABEL_Y_OFFSET : null;
      return localBoundingRadius(cluster, local, labelX, labelY);
    });
    const placements = placeClusters(radii);

    // Fit-to-budget: `placeClusters` guarantees no two discs overlap but not that the whole sky
    // fits where the camera can actually reach it — a big enough vault (a few hundred notes is
    // enough, see DOME_RADIUS_BUDGET's doc comment) still grows past it even with the denser
    // packing above. A single uniform scale, applied to every coordinate below, is the cheapest
    // fix that's provably still correct: scaling two already-separated discs by the same factor
    // can't make them intersect, so the non-overlap guarantee survives untouched. The honest
    // tradeoff: a vault big enough to need real shrinking also shrinks each constellation's own
    // internal star spacing — the sky reads as a dense field until the user zooms in, which is
    // correct star-chart behavior, not something this pass tries to hide.
    let maxReach = 0;
    for (const p of placements) {
      const reach = Math.hypot(p.cx, p.cy) + p.radius;
      if (reach > maxReach) maxReach = reach;
    }
    const scale = maxReach > DOME_RADIUS_BUDGET ? DOME_RADIUS_BUDGET / maxReach : 1;

    const labels: ConstellationLabel[] = [];
    const clusterOf = new Int32Array(n);
    clusters.forEach((cluster, ci) => {
      const cx = placements[ci].cx * scale;
      const cy = placements[ci].cy * scale;
      // Dome bulge toward the camera: the first (and, for small vaults, only) constellation sits
      // right at the orbit pivot (z=0) and later ones recede into -z toward the rim — a shallow
      // spherical cap whose centroid stays near the origin instead of dragging the whole shell off
      // to one side of wherever the camera happens to be orbiting. Based on cluster ORDER (not raw
      // placed radius): a many-cluster vault's raw packed radius (before the fit-to-budget scale
      // above) has no fixed relationship to SHELL_RADIUS any more, and basing the depth curve on it
      // directly would run its cosine argument well past 90°, folding the dome back toward the
      // camera instead of continuing to recede. `* scale` keeps depth proportionate to the same
      // shrink every other coordinate here just got, so the dome stays self-similar rather than
      // ending up flatter (or deeper) than its own footprint.
      const norm = ci / Math.max(1, clusters.length - 1);
      const cz = (Math.cos(norm * (Math.PI / 2) * 0.9) - 1) * SHELL_RADIUS * DEPTH_COMPRESSION * scale;

      for (const m of cluster) {
        const p = local.get(m)!;
        out[m * 3] = cx + p.x * scale;
        out[m * 3 + 1] = cy + p.y * scale;
        out[m * 3 + 2] = cz + p.z * scale;
        clusterOf[m] = ci;
      }

      const meta = clusterMeta[ci];
      if (meta) {
        labels.push({
          position: [cx + ((meta.bboxMinX + meta.bboxMaxX) / 2) * scale, cy + (meta.bboxMinY - LABEL_Y_OFFSET) * scale, cz],
          text: meta.patternName,
          matchPercent: Math.round(meta.score * 100),
        });
      }
    });
    this.labels = labels;
    this.clusterOf = clusterOf;
    // Scaled to match the positions actually written into `out` above — otherwise a test (or any
    // other consumer) asserting the no-overlap/fits-in-budget invariants against this field would
    // be checking the pre-scale geometry instead of what actually got rendered.
    this.clusterBounds = placements.map((p) => ({ cx: p.cx * scale, cy: p.cy * scale, radius: p.radius * scale }));
  }
}
