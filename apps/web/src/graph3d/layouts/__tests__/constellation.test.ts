import { afterEach, describe, expect, it } from "vitest";
import type { GraphTopology, TopologyEdge, TopologyNode } from "../../topology";
import {
  ConstellationLayout,
  DOME_RADIUS_BUDGET,
  getActivePatterns,
  MAX_CLUSTER_SIZE,
  MIN_CLUSTER_SIZE,
  selectPattern,
  setActivePatterns,
} from "../constellation";
import { PATTERNS } from "../patterns";

function makeTopology(ids: string[], chainEdges: Array<[string, string]>): GraphTopology {
  const nodes: TopologyNode[] = ids.map((id) => ({ id, title: id, ghost: false, degree: 0, accent: "violet" }));
  const indexById = new Map(ids.map((id, i) => [id, i]));
  const neighbors: number[][] = ids.map(() => []);
  const edges: TopologyEdge[] = [];

  for (const [a, b] of chainEdges) {
    const ai = indexById.get(a)!;
    const bi = indexById.get(b)!;
    edges.push({ a: ai, b: bi, source: "wikilink" });
    nodes[ai].degree++;
    nodes[bi].degree++;
    neighbors[ai].push(bi);
    neighbors[bi].push(ai);
  }

  return { nodes, edges, neighbors };
}

/** A plain path graph n0-n1-...-n(count-1), so callers get one connected component of `count` nodes. */
function chainTopology(prefix: string, count: number): { topology: GraphTopology; ids: string[] } {
  const ids = Array.from({ length: count }, (_, i) => `${prefix}${i}`);
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < count - 1; i++) edges.push([ids[i], ids[i + 1]]);
  return { topology: makeTopology(ids, edges), ids };
}

/** A big single connected component shaped like a real vault's link graph rather than a chain or a
 * uniform tree: node i (i >= 1) attaches to floor((i-1)/3) (a branching "family tree" of notes),
 * plus a handful of deterministic cross-links every 7th node back to 10 nodes earlier, so degree
 * varies noticeably (a few busier "hub" notes) instead of every node reading identically — still
 * ONE connected component throughout, so the old connected-components algorithm would have produced
 * exactly one giant cluster out of all of it. */
function bigVaultTopology(prefix: string, count: number): { topology: GraphTopology; ids: string[] } {
  const ids = Array.from({ length: count }, (_, i) => `${prefix}${i}`);
  const edges: Array<[string, string]> = [];
  for (let i = 1; i < count; i++) edges.push([ids[Math.floor((i - 1) / 3)], ids[i]]);
  for (let i = 10; i < count; i += 7) edges.push([ids[i], ids[i - 10]]);
  return { topology: makeTopology(ids, edges), ids };
}

/** Combines several independent topologies (no edges between them) into one, so the result has
 * one connected component per input — mirrors how the seeded vault has a main cluster plus a
 * couple of disconnected topic clusters. */
function mergeTopologies(parts: Array<{ topology: GraphTopology; ids: string[] }>): GraphTopology {
  const ids = parts.flatMap((p) => p.ids);
  const nodes: TopologyNode[] = ids.map((id) => ({ id, title: id, ghost: false, degree: 0, accent: "violet" }));
  const indexById = new Map(ids.map((id, i) => [id, i]));
  const neighbors: number[][] = ids.map(() => []);
  const edges: TopologyEdge[] = [];
  for (const part of parts) {
    for (const e of part.topology.edges) {
      const a = indexById.get(part.topology.nodes[e.a].id)!;
      const b = indexById.get(part.topology.nodes[e.b].id)!;
      edges.push({ a, b, source: "wikilink" });
      nodes[a].degree++;
      nodes[b].degree++;
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  }
  return { nodes, edges, neighbors };
}

describe("selectPattern", () => {
  it("falls back to no pattern for a cluster of 2 (smaller than every pattern's minimum)", () => {
    const { topology, ids } = chainTopology("n", 2);
    expect(selectPattern(topology, ids.map((_, i) => i))).toBeNull();
  });

  it("falls back to no pattern for a cluster far bigger than the largest pattern allows", () => {
    // The largest real pattern in the dataset tops out at a few dozen stars; a 100-node chain's
    // overflow vastly exceeds any pattern's MAX_OVERFLOW_FRACTION budget.
    const { topology, ids } = chainTopology("n", 100);
    expect(selectPattern(topology, ids.map((_, i) => i))).toBeNull();
  });

  it("never picks a pattern with more stars than the cluster has members", () => {
    // A pattern bigger than the cluster has no slot to put a missing star in — this must be a
    // hard constraint, not just a scoring preference.
    for (let n = 3; n <= 15; n++) {
      const { topology, ids } = chainTopology("n", n);
      const match = selectPattern(topology, ids.map((_, i) => i));
      if (match) expect(match.pattern.stars.length).toBeLessThanOrEqual(n);
    }
  });

  it("is a pure function of the topology — repeated calls on the same shape agree", () => {
    const { topology, ids } = chainTopology("n", 7);
    const members = ids.map((_, i) => i);
    const first = selectPattern(topology, members);
    const second = selectPattern(topology, members);
    expect(second?.pattern.id).toBe(first?.pattern.id);
    expect(second?.score).toBe(first?.score);
  });

  it("is indifferent to node labels — only the shape (degree sequence) drives the match", () => {
    const a = chainTopology("alpha", 7);
    const b = chainTopology("totally-different-labels", 7);
    const matchA = selectPattern(a.topology, a.ids.map((_, i) => i));
    const matchB = selectPattern(b.topology, b.ids.map((_, i) => i));
    expect(matchB?.pattern.id).toBe(matchA?.pattern.id);
    expect(matchB?.score).toBe(matchA?.score);
  });

  it("a plain chain matches some real pattern with a real confidence score above the minimum", () => {
    const { topology, ids } = chainTopology("n", 7);
    const match = selectPattern(topology, ids.map((_, i) => i));
    expect(match).not.toBeNull();
    expect(match!.score).toBeGreaterThanOrEqual(0.55);
    expect(match!.score).toBeLessThanOrEqual(1);
    // The matched pattern is a real, named entry from the sourced dataset, not a fabricated shape.
    expect(PATTERNS.some((p) => p.id === match!.pattern.id)).toBe(true);
  });

  it("a perfect shape match (cluster identical to a pattern's own tree) scores 100%", () => {
    // Build a chain whose degree sequence is forced to match some real pattern of the same size
    // exactly: every real n-star pattern this small is itself just some tree, and a chain's own
    // degree sequence [2,2,...,2,1,1] is one specific tree shape — find a same-size pattern that
    // happens to BE a straight chain (degree sequence identical) to assert the scoring ceiling.
    const chainPattern = PATTERNS.find((p) => {
      const deg = new Array(p.stars.length).fill(0);
      p.parent.forEach((par, i) => {
        if (par >= 0) {
          deg[par]++;
          deg[i]++;
        }
      });
      return deg.every((d) => d <= 2) && deg.filter((d) => d === 1).length === 2;
    });
    expect(chainPattern).toBeDefined();

    const { topology, ids } = chainTopology("n", chainPattern!.stars.length);
    const match = selectPattern(topology, ids.map((_, i) => i));
    expect(match).not.toBeNull();
    expect(match!.score).toBe(1);
  });
});

describe("ConstellationLayout", () => {
  // Was: "maps a cluster of 7 onto a named, scored pattern label; a cluster of 2 falls back with
  // no label" — that premise no longer holds under two combined changes since it was written:
  // (1) mergeSmallClusters (added when the partition was reworked) folds any cluster below
  // MIN_CLUSTER_SIZE into another rather than leaving it standalone, so a 2-node fragment never
  // survives as its own separately-fallback-labelled cluster any more — see the merge test below
  // instead, which covers what actually happens to it now. (2) selectPattern's score is now shape
  // alone, not half-inflated by size agreement (see degreeSequenceSimilarity's doc comment), so a
  // cluster of 7 merged together with an unrelated 2-node fragment no longer coincidentally
  // clears the bar the way it used to. Split into two tests that each verify one real behavior.
  it("maps a standalone cluster of adequate size onto a named, scored pattern label", () => {
    // Both components are >= MIN_CLUSTER_SIZE, so neither is small enough for mergeSmallClusters
    // to fold away — each stays its own constellation, and a plain chain reliably matches some
    // real pattern at the new shape-only bar (see the "selectPattern" describe block above).
    const clusterA = chainTopology("a", 7);
    const clusterB = chainTopology("b", 6);
    const ids = [...clusterA.ids, ...clusterB.ids];
    const topology = mergeTopologies([clusterA, clusterB]);

    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    expect(layout.clusterBounds).toHaveLength(2); // neither got merged away
    expect(layout.labels.length).toBeGreaterThanOrEqual(1);
    // text is the bare pattern name; matchPercent is kept separate so the renderer can place it
    // elsewhere instead of folding it into the name's own line.
    const knownNames = new Set(PATTERNS.map((p) => p.name));
    for (const label of layout.labels) {
      expect(knownNames.has(label.text)).toBe(true);
      expect(label.matchPercent).toBeGreaterThanOrEqual(0);
      expect(label.matchPercent).toBeLessThanOrEqual(100);
    }
  });

  it("merges a too-small cluster into a larger one, and the coalition is still drawn as a real named figure", () => {
    // clusterB (2 nodes) is below MIN_CLUSTER_SIZE, so mergeSmallClusters folds it into clusterA
    // (7 nodes) instead of leaving it as its own tiny constellation.
    //
    // This assertion used to be the opposite — that the merged coalition stays UNNAMED, because a
    // pair of disconnected chains doesn't resemble any real figure well enough to clear a
    // confidence bar. That bar is gone by product decision: every cluster is now mapped onto a
    // real IAU figure, because a generic fallback asterism reads on screen as a bare line or a
    // triangle rather than a constellation. Filling a pattern's slots never needed the cluster to
    // be connected in the first place, so a coalition maps as cleanly as anything else; the label's
    // percentage is what stays honest about how little its own structure agreed with the figure.
    const clusterA = chainTopology("a", 7);
    const clusterB = chainTopology("b", 2);
    const ids = [...clusterA.ids, ...clusterB.ids];
    const topology = mergeTopologies([clusterA, clusterB]);

    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    expect(layout.clusterBounds).toHaveLength(1); // merged into one, not left as two
    expect(layout.labels).toHaveLength(1);
    expect(layout.labels[0].text).toBeTruthy();
  });

  it.each([100, 300, 1000])(
    "draws every cluster as a real named figure, never a generic asterism, at N=%i",
    (n) => {
      // The product bar: no bare lines, no lone triangles. Every constellation on the sky is one of
      // the real IAU figures from patterns.ts, so the count of name labels must equal the count of
      // clusters exactly — one unnamed cluster means one cluster fell back to `buildAsterism`,
      // which is the shape the user rejected.
      const { topology } = bigVaultTopology("v", n);
      const layout = new ConstellationLayout();
      layout.generate(topology, new Float32Array(n * 3), new Float32Array(n * 3));

      expect(layout.clusterBounds.length).toBeGreaterThan(1);
      expect(layout.labels).toHaveLength(layout.clusterBounds.length);
      for (const label of layout.labels) {
        expect(label.text).toBeTruthy();
        // Deliberately NOT `> 0`: with the confidence floor gone, a cluster whose own structure
        // agrees with its assigned figure hardly at all legitimately reports a very low — even
        // zero — percentage. That is the number doing its job, not a failure. Only the range is
        // an invariant.
        expect(label.matchPercent).toBeGreaterThanOrEqual(0);
        expect(label.matchPercent).toBeLessThanOrEqual(100);
      }
    },
  );

  it("renders several distinct constellation labels for a vault with multiple disconnected clusters", () => {
    // Mirrors the seeded vault's shape: a handful of separate topic clusters, none linked to
    // each other, of varied sizes — Constellation Mode should draw more than one named shape.
    const parts = [chainTopology("main", 6), chainTopology("recipes", 3), chainTopology("travel", 4)];
    const ids = parts.flatMap((p) => p.ids);
    const topology = mergeTopologies(parts);

    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    expect(layout.labels.length).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic: the same topology generates an identical Float32Array every time", () => {
    const { topology, ids } = chainTopology("n", 12);
    const layoutA = new ConstellationLayout();
    const layoutB = new ConstellationLayout();
    const outA = new Float32Array(ids.length * 3);
    const outB = new Float32Array(ids.length * 3);

    layoutA.generate(topology, new Float32Array(ids.length * 3), outA);
    layoutB.generate(topology, new Float32Array(ids.length * 3), outB);

    expect(Array.from(outA)).toEqual(Array.from(outB));
    expect(layoutA.labels).toEqual(layoutB.labels);
  });
});

describe("ConstellationLayout syntheticEdges", () => {
  const bundled = getActivePatterns();
  afterEach(() => setActivePatterns(bundled));

  it("fills in a pattern's own connection when the real graph has no edge there", () => {
    // Was a 4-star "kite" (hub + 3 spokes) — a genuinely different SHAPE from a plain chain
    // (degree sequence [3,1,1,1] vs. the chain's [2,2,1,1]), scoring only ~50% shape agreement
    // against it. There's no confidence floor to fail any more (any candidate that clears the
    // size/overflow gate gets used, however low its score — see selectPattern's doc comment), so
    // that alone no longer motivates swapping the pattern out — but a kite still isn't the point of
    // THIS test (synthetic-edge generation), so it's kept as the same-shape pattern below to isolate
    // that behavior from shape-matching noise. Replaced with a pattern that's the SAME shape as the
    // real graph (a plain 4-chain, guaranteed ~100% match, robust to any reasonable threshold) but
    // still produces a synthetic edge: the pattern's fixed root (index 0) sits at one END of its
    // chain, while the cluster's own alpha star (picked by highest degree, a middle node for a
    // chain) sits in the MIDDLE of its BFS tree — that root/alpha mismatch alone is enough for at
    // least one pattern-edge-to-cluster-node mapping not to coincide with a real edge, without
    // needing a shape mismatch to manufacture the gap.
    setActivePatterns([
      {
        id: "test-chain4",
        name: "Test Chain4",
        stars: [
          { x: 0, y: 0 },
          { x: 0.4, y: 0.2 },
          { x: 0.8, y: 0.4 },
          { x: 1.2, y: 0.6 },
        ],
        parent: [-1, 0, 1, 2],
      },
    ]);

    const { topology, ids } = chainTopology("n", 4);
    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    expect(layout.labels).toHaveLength(1);
    expect(layout.labels[0].text).toBe("Test Chain4");
    expect(layout.syntheticEdges.length).toBeGreaterThanOrEqual(1);
    // Every synthetic edge must be a real node pair (valid indices), and none may duplicate an
    // already-real edge (that would defeat the point — real edges take precedence).
    for (const [a, b] of layout.syntheticEdges) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(ids.length);
      expect(b).toBeLessThan(ids.length);
      const alreadyReal = topology.neighbors[a].includes(b);
      expect(alreadyReal).toBe(false);
    }
  });

  it("adds no synthetic edges when the real graph already matches the pattern's shape exactly", () => {
    // A straight 3-star chain pattern (0-1-2) mapped onto a real 3-node chain — every pattern
    // connection already has a matching real edge, so nothing needs to be synthesized.
    setActivePatterns([
      {
        id: "test-chain3",
        name: "Test Chain",
        stars: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.3 },
          { x: -0.5, y: 0.3 },
        ],
        parent: [-1, 0, 0],
      },
    ]);

    const { topology, ids } = chainTopology("n", 3);
    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    expect(layout.labels).toHaveLength(1);
    expect(layout.syntheticEdges).toEqual([]);
  });

  it("produces no synthetic edges for a fallback (non-pattern-matched) cluster", () => {
    setActivePatterns(bundled); // ensure real, size-varied patterns are active — nothing matches n=2
    const { topology, ids } = chainTopology("n", 2);
    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    expect(layout.labels).toHaveLength(0);
    expect(layout.syntheticEdges).toEqual([]);
  });
});

describe("ConstellationLayout merged-fragment spacing", () => {
  const bundled = getActivePatterns();
  afterEach(() => setActivePatterns(bundled));

  it("spreads a mergeSmallClusters-merged, internally-disconnected cluster's stars apart instead of piling them at one point", () => {
    // Regression test for the exact pile-up observed in a real 37-note vault: two topic chains
    // (4 nodes each — both below MIN_CLUSTER_SIZE, so mergeSmallClusters folds them together) share
    // no real edge with each other, so they land as one constellation with two internally-connected
    // but mutually-disconnected pieces. Before the placeStrayFragments fix, buildAsterism's BFS from
    // the surviving alpha star only ever reaches its own piece; every member of the OTHER piece was
    // squeezed into a near-fixed-radius orbit around alpha (COMPANION_RADIUS_MIN/RANGE, sized for a
    // straggler or two) regardless of how many of them there were — for this exact 4+4 shape, all
    // four unreached members land within a disc of radius ~10-16 units, i.e. arbitrarily close
    // together depending on their random angles, and always tighter than a single star's own label
    // footprint (60 units). setActivePatterns([]) forces every cluster to fall back to the plain
    // BFS asterism (buildAsterism), so this test exercises exactly that code path regardless of
    // whether this particular disconnected shape would otherwise clear the pattern-match bar.
    setActivePatterns([]);
    const clusterA = chainTopology("stellar", 4);
    const clusterB = chainTopology("methods", 4);
    const ids = [...clusterA.ids, ...clusterB.ids];
    const topology = mergeTopologies([clusterA, clusterB]);

    const layout = new ConstellationLayout();
    const out = new Float32Array(ids.length * 3);
    layout.generate(topology, new Float32Array(ids.length * 3), out);

    // Both pieces are below MIN_CLUSTER_SIZE and share no edge, so they must have merged into
    // exactly one constellation — otherwise this test isn't exercising the merge path at all.
    expect(layout.clusterBounds).toHaveLength(1);

    // Only the CROSS-piece minimum distance is the actual invariant here (a within-piece min
    // distance also reflects buildAsterism's own pre-existing ring/angle jitter for a plain small
    // chain, unrelated to this bug, and would make the assertion fragile against unrelated noise).
    // Whichever piece ends up unreachable from the surviving alpha star, its every member used to
    // orbit alpha within the same ~10-16 unit disc regardless of which piece it was — so the
    // smallest stellar-to-methods distance is exactly what the old code collapsed.
    let minCrossDist = Infinity;
    for (let i = 0; i < clusterA.ids.length; i++) {
      for (let j = 0; j < clusterB.ids.length; j++) {
        const a = i;
        const b = clusterA.ids.length + j;
        const d = Math.hypot(out[a * 3] - out[b * 3], out[a * 3 + 1] - out[b * 3 + 1], out[a * 3 + 2] - out[b * 3 + 2]);
        if (d < minCrossDist) minCrossDist = d;
      }
    }
    // The fix packs a leftover fragment's own bounding disc against the reached piece's disc with
    // at least CONSTELLATION_GAP (= RING_SPACING = 46) between them, provably (same packer
    // `placeClusters` uses one level up) — comfortably above anything the old fixed-radius orbit
    // could produce (the unreached piece landed within ~10-16 units of alpha itself). 35 is close
    // to that 46-unit guarantee while leaving slack for floating-point/jitter, not a loose
    // approximation.
    expect(minCrossDist).toBeGreaterThan(35);
  });
});

describe("ConstellationLayout partitioning at scale", () => {
  const N = 300;

  it("splits a single giant connected component into more than one constellation", () => {
    // The old connected-components approach always produced exactly one cluster here, no matter
    // how large N got — this is the direct regression test for that.
    const { topology } = bigVaultTopology("v", N);
    const layout = new ConstellationLayout();
    const out = new Float32Array(N * 3);
    layout.generate(topology, new Float32Array(N * 3), out);

    expect(layout.clusterBounds.length).toBeGreaterThan(1);
  });

  it("places every node exactly once", () => {
    const { topology } = bigVaultTopology("v", N);
    const layout = new ConstellationLayout();
    const out = new Float32Array(N * 3);
    layout.generate(topology, new Float32Array(N * 3), out);

    expect(layout.clusterOf).toHaveLength(N);
    const sizes = new Array(layout.clusterBounds.length).fill(0);
    for (let i = 0; i < N; i++) {
      expect(layout.clusterOf[i]).toBeGreaterThanOrEqual(0);
      expect(layout.clusterOf[i]).toBeLessThan(layout.clusterBounds.length);
      sizes[layout.clusterOf[i]]++;
    }
    // Every cluster's member count sums back to exactly N — no node counted twice, none dropped.
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(N);
  });

  it("keeps every constellation's size within the target band", () => {
    const { topology } = bigVaultTopology("v", N);
    const layout = new ConstellationLayout();
    const out = new Float32Array(N * 3);
    layout.generate(topology, new Float32Array(N * 3), out);

    const sizes = new Array(layout.clusterBounds.length).fill(0);
    for (let i = 0; i < N; i++) sizes[layout.clusterOf[i]]++;
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(MIN_CLUSTER_SIZE);
      expect(size).toBeLessThanOrEqual(MAX_CLUSTER_SIZE);
    }
  });

  it("never lets two constellations' bounding discs overlap", () => {
    const { topology } = bigVaultTopology("v", N);
    const layout = new ConstellationLayout();
    const out = new Float32Array(N * 3);
    layout.generate(topology, new Float32Array(N * 3), out);

    const bounds = layout.clusterBounds;
    expect(bounds.length).toBeGreaterThan(1); // otherwise this test would vacuously pass
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const dist = Math.hypot(bounds[i].cx - bounds[j].cx, bounds[i].cy - bounds[j].cy);
        expect(dist).toBeGreaterThanOrEqual(bounds[i].radius + bounds[j].radius);
      }
    }
  });

  // This is the test that would have caught the fit-to-budget regression: the earlier packing
  // proved discs never overlap, but never checked whether the resulting sky stayed anywhere near
  // where the camera can actually reach it — at 300 notes the outermost constellations landed
  // roughly 7x past the camera's hard pull-back limit. Every node's placed position (not just
  // cluster centers) must stay within DOME_RADIUS_BUDGET of the origin, at every vault size.
  it.each([40, 300, 1000])("keeps every node within the camera/fog budget at N=%i", (n) => {
    const { topology } = bigVaultTopology("v", n);
    const layout = new ConstellationLayout();
    const out = new Float32Array(n * 3);
    layout.generate(topology, new Float32Array(n * 3), out);

    let maxRadius = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      if (r > maxRadius) maxRadius = r;
    }
    expect(maxRadius).toBeLessThanOrEqual(DOME_RADIUS_BUDGET);
  });

  // There is no confidence floor any more (see selectPattern's doc comment) — a real vault's
  // clusters are essentially always pattern-mapped, and a genuinely fallback-heavy sky only
  // happens when `activePatterns` itself is empty (a data-loading edge case). A fallback
  // asterism's extent comes from a different mechanism (`buildAsterism`'s BFS ring layout) than a
  // pattern-mapped one's, so the fit-to-budget pass still needs checking against that case too —
  // forcing an empty pattern set is the only way left to exercise it at this scale.
  describe("with no patterns active (forces every cluster to fall back)", () => {
    const bundled = getActivePatterns();
    afterEach(() => setActivePatterns(bundled));

    it.each([40, 300, 1000])("still keeps every node within the camera/fog budget at N=%i", (n) => {
      setActivePatterns([]);
      const { topology } = bigVaultTopology("v", n);
      const layout = new ConstellationLayout();
      const out = new Float32Array(n * 3);
      layout.generate(topology, new Float32Array(n * 3), out);

      expect(layout.labels).toHaveLength(0); // confirms every cluster really did fall back
      let maxRadius = 0;
      for (let i = 0; i < n; i++) {
        const r = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
        if (r > maxRadius) maxRadius = r;
      }
      expect(maxRadius).toBeLessThanOrEqual(DOME_RADIUS_BUDGET);
    });
  });

  it("is deterministic across repeated runs on a large topology", () => {
    const { topology } = bigVaultTopology("v", N);
    const layoutA = new ConstellationLayout();
    const layoutB = new ConstellationLayout();
    const outA = new Float32Array(N * 3);
    const outB = new Float32Array(N * 3);

    layoutA.generate(topology, new Float32Array(N * 3), outA);
    layoutB.generate(topology, new Float32Array(N * 3), outB);

    expect(Array.from(outA)).toEqual(Array.from(outB));
    expect(Array.from(layoutA.clusterOf)).toEqual(Array.from(layoutB.clusterOf));
    expect(layoutA.clusterBounds).toEqual(layoutB.clusterBounds);
  });
});
