import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type ForceCollide,
  type ForceLink,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type ForceZ,
  type Simulation,
  type SimulationLinkDatum3D,
  type SimulationNodeDatum3D,
} from "d3-force-3d";
import { starSize, type GraphTopology } from "./topology";

interface SimNode extends SimulationNodeDatum3D {
  index: number;
}

type SimLink = SimulationLinkDatum3D<SimNode>;

/** The Graph settings panel's Forces sliders, mapped straight onto the underlying d3-force-3d
 * force each one drives — see `GraphPhysics.setForces`. Mirrors `GraphForces` in store.ts
 * structurally (kept as a separate local type so this module doesn't import the store). */
export interface GraphForceParams {
  center: number;
  repel: number;
  linkForce: number;
  linkDistance: number;
}

/** Below this alpha the layout is visually settled — stop paying for tick()s. */
export const SETTLE_ALPHA = 0.006;

/** Maps the Forces panel's "Center" slider (0-2, default 1) onto each per-axis gravity force's
 * `.strength()` below. `forceCenter(0,0,0)` (the old mechanism) only ever translates the overall
 * centroid to the origin — it never changes spacing *between* disconnected clusters
 * ("archipelagos"), which is what the slider is supposed to control. Per-node positional gravity
 * (`forceX`/`forceY`/`forceZ` toward 0) does: raising it pulls separate clusters together, and it
 * still keeps the whole graph centered same as `forceCenter` did as a side effect. Picked by eye
 * against this file's charge (-150) and link distance (70) so the slider's default (1) reproduces
 * roughly the old compactness. */
const CENTER_GRAVITY_K = 0.05;

/** Once the anchored settle (see `anchorExcept`) decays past this, the temporarily-fixed
 * surviving nodes are released so they get a few ticks of gentle local give before the layout
 * settles. Above SETTLE_ALPHA, so release always happens while the host is still ticking. */
const RELEASE_ALPHA = 0.015;

/** A layout whose nodes all sit this close to z=0 counts as flat — see `setFlatten`'s symmetry
 * problem. Well under one link distance (70), so a genuinely 3D layout never reads as flat. */
const FLAT_EPSILON = 0.5;

/** Half-width of the z band `spreadZ` seeds a flat layout into. Small next to link distance (70):
 * enough to break the plane, small enough that the depth visibly *grows* out of the forces rather
 * than the graph jumping apart the instant 3D is switched on. */
const UNFLATTEN_SPREAD = 12;

/**
 * Thin wrapper around a d3-force-3d simulation. It owns the only mutable
 * physics state (the simulation's node objects); everything else — the
 * shared `positions` buffer, the renderer, the transition — reads snapshots
 * via `copyPositionsTo`. The simulation's own rAF-driven timer is stopped
 * immediately after construction: the host (GraphView3D) ticks it exactly
 * once per animation frame, and only while a force layout is active and
 * unsettled, so an idle or Constellation-mode graph does zero physics work.
 */
export class GraphPhysics {
  private readonly sim: Simulation<SimNode, SimLink>;
  private readonly simNodes: SimNode[];

  /** Whether charge, collision and links currently run in a genuine XY plane. */
  private flattened = false;
  private forceParams: GraphForceParams = { center: 1, repel: -150, linkForce: .5, linkDistance: 70 };

  /** Nodes temporarily fixed by `anchorExcept` for the duration of one incremental settle; auto-
   * released in `tick` once alpha decays past RELEASE_ALPHA. Empty except during that window. */
  private tempAnchored: number[] = [];

  /** `pinned` marks nodes whose position is fixed from the start, via d3-force's standard
   * fx/fy/fz. As of Phase 16 the host never populates this from persisted `graph.pins` (drag no
   * longer freezes a star — see docs/WORKSPACE-3D.md); it's kept as a general mechanism. */
  constructor(private readonly topology: GraphTopology, positions: Float32Array, pinned?: ReadonlySet<number>) {
    this.simNodes = topology.nodes.map((_, i) => {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const fixed = pinned?.has(i);
      return {
        index: i,
        x,
        y,
        z,
        vx: 0,
        vy: 0,
        vz: 0,
        fx: fixed ? x : null,
        fy: fixed ? y : null,
        fz: fixed ? z : null,
      };
    });
    const links: SimLink[] = topology.edges.map((e) => ({ source: e.a, target: e.b }));

    this.sim = forceSimulation<SimNode, SimLink>(this.simNodes, 3)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((_d, i) => i)
          .distance(70)
          .strength(0.5),
      )
      .force("charge", forceManyBody<SimNode>().strength(-150).distanceMax(600))
      // Namespaced "gravityX/Y/Z" — distinct from `setFlatten`'s own "flattenZ" forceZ key, so the
      // two coexist rather than one clobbering the other's registration on the same key.
      .force("gravityX", forceX<SimNode>(0).strength(CENTER_GRAVITY_K))
      .force("gravityY", forceY<SimNode>(0).strength(CENTER_GRAVITY_K))
      .force("gravityZ", forceZ<SimNode>(0).strength(CENTER_GRAVITY_K))
      .force(
        "collide",
        forceCollide<SimNode>((d) => starSize(topology.nodes[d.index].degree) + 10),
      )
      .alphaMin(SETTLE_ALPHA)
      .stop();
  }

  /** True while alpha is still above the settle threshold — the host should keep calling tick(). */
  get isSettled(): boolean {
    return this.sim.alpha() <= this.sim.alphaMin();
  }

  get alpha(): number {
    return this.sim.alpha();
  }

  /** Advance the simulation by exactly one step. */
  tick(): void {
    this.sim.tick();
    if (this.flattened) for (const node of this.simNodes) { node.z = 0; node.vz = 0; }
    if (this.tempAnchored.length && this.sim.alpha() < RELEASE_ALPHA) {
      for (const i of this.tempAnchored) {
        const node = this.simNodes[i];
        node.fx = node.fy = node.fz = null;
      }
      this.tempAnchored = [];
    }
  }

  /**
   * Incremental-settle helper: fixes every node EXCEPT `keepFree` at its current position, then
   * reheats. Only the free node(s) — a just-created note — move under the forces; the already-
   * settled rest of the layout stays put instead of the fresh sim hopping the whole small graph to
   * a different equilibrium basin (the ~100-unit reshuffle-on-create bug). `tick` releases the
   * anchors near the end of the decay so the neighbors get a small local give, not a hard freeze.
   */
  anchorExcept(keepFree: ReadonlySet<number>): void {
    this.tempAnchored = [];
    for (const node of this.simNodes) {
      if (keepFree.has(node.index)) continue;
      node.fx = node.x ?? 0;
      node.fy = node.y ?? 0;
      node.fz = node.z ?? 0;
      this.tempAnchored.push(node.index);
    }
    this.reheat(0.4);
  }

  /** Raise alpha to resume motion (e.g. returning from a static Constellation layout). */
  reheat(alpha = 0.4): void {
    this.sim.alpha(Math.max(this.sim.alpha(), alpha));
  }

  /** Change solver dimension, restoring depth when returning to 3D. */
  setFlatten(flatten: boolean): void {
    if (flatten === this.flattened) {
      if (!flatten && this.isFlat()) this.spreadZ();
      return;
    }
    this.flattened = flatten;
    // A 3D simulation squeezed toward z=0 still resolves collisions in depth.
    // Use genuine planar charge, collision and link forces in 2D instead.
    this.sim.numDimensions(flatten ? 2 : 3);
    if (flatten) {
      for (const node of this.simNodes) { node.z = 0; node.vz = 0; if (node.fz != null) node.fz = 0; }
    } else if (this.isFlat()) this.spreadZ();
    this.applyForces();
    this.reheat(.8);
  }

  /** Re-settle the current view without resetting the camera or reloading notes. */
  arrange(): void {
    for (const i of this.tempAnchored) {
      const node = this.simNodes[i]; node.fx = node.fy = node.fz = null;
    }
    this.tempAnchored = [];
    for (const node of this.simNodes) { node.vx = node.vy = node.vz = 0; }
    this.reheat(.8);
  }

  /** True when every free node sits within FLAT_EPSILON of the z=0 plane. */
  private isFlat(): boolean {
    return this.simNodes.every((node) => node.fz != null || Math.abs(node.z ?? 0) < FLAT_EPSILON);
  }

  /** Seeds each free node with a small deterministic z offset (no RNG — same topology always
   * un-flattens the same way, so tests and reloads are reproducible). The forces take it from
   * there and expand it into a real 3D layout. */
  private spreadZ(): void {
    for (const node of this.simNodes) {
      if (node.fz != null) continue;
      // Cheap integer hash → [-1, 1); the interleaving matters more than the distribution, since
      // any two nodes landing on different sides of the plane is all the sim needs to escape it.
      const h = ((node.index + 1) * 2654435761) % 2147483647;
      node.z = ((h / 2147483647) * 2 - 1) * UNFLATTEN_SPREAD;
      node.vz = 0;
    }
  }

  /**
   * Live-adjusts the center/repel/link forces' strengths (and link distance) from the Graph
   * settings panel's Forces sliders, then reheats so the change is visibly applied — same reheat
   * pattern as `setFlatten`. Values map straight onto the underlying d3-force-3d force's own
   * parameter (center's `strength` on the `gravityX/Y/Z` forces via `CENTER_GRAVITY_K`, charge's
   * `strength`, link's `strength`/`distance`); the
   * defaults in store.ts's `DEFAULT_GRAPH_SETTINGS` match this class's constructor above, so an
   * untouched panel changes nothing. Like `setFlatten`, callers must re-apply this to every
   * freshly-created `GraphPhysics` — a topology rebuild swaps the sim wholesale and starts every
   * force back at its hard-coded default.
   */
  setForces(params: GraphForceParams): void {
    this.forceParams = { ...params };
    this.applyForces();
    this.reheat(.5);
  }

  private applyForces(): void {
    const params = this.forceParams;
    const flat = this.flattened;
    const gravity = params.center * CENTER_GRAVITY_K * (flat ? .4 : 1);
    (this.sim.force("gravityX") as ForceX<SimNode>)?.strength(gravity);
    (this.sim.force("gravityY") as ForceY<SimNode>)?.strength(gravity);
    (this.sim.force("gravityZ") as ForceZ<SimNode>)?.strength(flat ? 0 : gravity);
    (this.sim.force("charge") as ForceManyBody<SimNode>)?.strength(params.repel * (flat ? 2.4 : 1)).distanceMax(flat ? 1400 : 600);
    const link = this.sim.force("link") as ForceLink<SimNode, SimLink>;
    const degree = (edge: SimLink) => Math.max(this.topology.nodes[(edge.source as SimNode).index].degree, this.topology.nodes[(edge.target as SimNode).index].degree);
    link?.strength(flat ? edge => params.linkForce / Math.sqrt(Math.max(1, degree(edge))) : params.linkForce);
    link?.distance(flat ? edge => Math.max(100, params.linkDistance * 1.6) + Math.min(20, degree(edge)) * 2 : params.linkDistance);
    (this.sim.force("collide") as ForceCollide<SimNode>)
      ?.radius(node => starSize(this.topology.nodes[node.index].degree) + (flat ? 28 + Math.min(24, this.topology.nodes[node.index].title.length * .8) : 10))
      .iterations(flat ? 3 : 1).strength(flat ? .95 : 1);
  }

  /** Fix a node's position (d3-force's standard fx/fy/fz) — set every frame while dragging. As of
   * Phase 16 the host calls `unpin` on release instead of leaving it fixed, so the star rejoins
   * the simulation rather than staying pinned. See docs/WORKSPACE-3D.md. */
  pin(index: number, x: number, y: number, z: number): void {
    const node = this.simNodes[index];
    node.x = node.fx = x;
    node.y = node.fy = y;
    node.z = node.fz = this.flattened ? 0 : z;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
  }

  /** Release a pinned node back to the simulation. */
  unpin(index: number): void {
    const node = this.simNodes[index];
    node.fx = null;
    node.fy = null;
    node.fz = null;
  }

  /** Snap the simulation's own node positions to an external buffer (no velocity change is implied). */
  setPositions(positions: Float32Array): void {
    for (const node of this.simNodes) {
      node.x = positions[node.index * 3];
      node.y = positions[node.index * 3 + 1];
      node.z = this.flattened ? 0 : positions[node.index * 3 + 2];
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    }
  }

  copyPositionsTo(out: Float32Array): void {
    for (const node of this.simNodes) {
      out[node.index * 3] = node.x ?? 0;
      out[node.index * 3 + 1] = node.y ?? 0;
      out[node.index * 3 + 2] = node.z ?? 0;
    }
  }

  dispose(): void {
    this.sim.stop();
  }
}
