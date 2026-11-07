/**
 * Minimal hand-written types for `d3-force-3d` (no official `@types`
 * package exists). Covers only the forces this module actually uses —
 * `forceSimulation`/`forceLink`/`forceManyBody`/`forceCenter`/`forceCollide`/
 * `forceZ` — shaped after `@types/d3-force`, extended with the z/vz/fz
 * dimension.
 */
declare module "d3-force-3d" {
  export interface SimulationNodeDatum3D {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum3D<NodeDatum extends SimulationNodeDatum3D> {
    source: NodeDatum | string | number;
    target: NodeDatum | string | number;
    index?: number;
  }

  export interface Simulation<NodeDatum extends SimulationNodeDatum3D, LinkDatum> {
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    force(name: string): unknown;
    force(name: string, force: unknown | null): this;
    numDimensions(): number;
    numDimensions(n: number): this;
    tick(iterations?: number): this;
    restart(): this;
    stop(): this;
    on(typenames: string, listener?: (this: Simulation<NodeDatum, LinkDatum>) => void): this;
  }

  export function forceSimulation<NodeDatum extends SimulationNodeDatum3D = SimulationNodeDatum3D, LinkDatum = unknown>(
    nodes?: NodeDatum[],
    numDimensions?: number,
  ): Simulation<NodeDatum, LinkDatum>;

  export interface ForceLink<NodeDatum extends SimulationNodeDatum3D, LinkDatum extends SimulationLinkDatum3D<NodeDatum>> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random: () => number, numDimensions: number): void;
    links(): LinkDatum[];
    links(links: LinkDatum[]): this;
    id(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => string | number;
    id(id: (d: NodeDatum, i: number, nodes: NodeDatum[]) => string | number): this;
    distance(): (link: LinkDatum, i: number, links: LinkDatum[]) => number;
    distance(distance: number | ((link: LinkDatum, i: number, links: LinkDatum[]) => number)): this;
    strength(): (link: LinkDatum, i: number, links: LinkDatum[]) => number;
    strength(strength: number | ((link: LinkDatum, i: number, links: LinkDatum[]) => number)): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  export function forceLink<NodeDatum extends SimulationNodeDatum3D, LinkDatum extends SimulationLinkDatum3D<NodeDatum>>(
    links?: LinkDatum[],
  ): ForceLink<NodeDatum, LinkDatum>;

  export interface ForceManyBody<NodeDatum extends SimulationNodeDatum3D> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random: () => number, numDimensions: number): void;
    strength(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    strength(strength: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    distanceMin(): number;
    distanceMin(distance: number): this;
    distanceMax(): number;
    distanceMax(distance: number): this;
    theta(): number;
    theta(theta: number): this;
  }

  export function forceManyBody<NodeDatum extends SimulationNodeDatum3D>(): ForceManyBody<NodeDatum>;

  export interface ForceCenter<NodeDatum extends SimulationNodeDatum3D> {
    (): void;
    initialize?(nodes: NodeDatum[]): void;
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
    strength(): number;
    strength(strength: number): this;
  }

  export function forceCenter<NodeDatum extends SimulationNodeDatum3D>(
    x?: number,
    y?: number,
    z?: number,
  ): ForceCenter<NodeDatum>;

  export interface ForceCollide<NodeDatum extends SimulationNodeDatum3D> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random: () => number, numDimensions: number): void;
    radius(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    radius(radius: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    strength(): number;
    strength(strength: number): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  export function forceCollide<NodeDatum extends SimulationNodeDatum3D>(
    radius?: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number),
  ): ForceCollide<NodeDatum>;

  /** Positioning force pulling nodes toward a fixed `z` — used for the 2D "flatten" force (see
   * `physics.ts`'s `setFlatten`). Shaped after `@types/d3-force`'s `ForceX`/`ForceY`. */
  export interface ForceZ<NodeDatum extends SimulationNodeDatum3D> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[]): void;
    strength(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    strength(strength: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    z(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    z(z: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
  }

  export function forceZ<NodeDatum extends SimulationNodeDatum3D>(
    z?: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number),
  ): ForceZ<NodeDatum>;

  /** Positioning force pulling nodes toward a fixed `x`/`y` — same shape as `ForceZ` above, used
   * for the Forces panel's "Center" slider (see `physics.ts`'s `setForces`). */
  export interface ForceX<NodeDatum extends SimulationNodeDatum3D> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[]): void;
    strength(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    strength(strength: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    x(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    x(x: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
  }

  export function forceX<NodeDatum extends SimulationNodeDatum3D>(
    x?: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number),
  ): ForceX<NodeDatum>;

  export interface ForceY<NodeDatum extends SimulationNodeDatum3D> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[]): void;
    strength(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    strength(strength: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
    y(): (d: NodeDatum, i: number, nodes: NodeDatum[]) => number;
    y(y: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this;
  }

  export function forceY<NodeDatum extends SimulationNodeDatum3D>(
    y?: number | ((d: NodeDatum, i: number, nodes: NodeDatum[]) => number),
  ): ForceY<NodeDatum>;
}
