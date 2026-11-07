import type { GraphTopology } from "../topology";

/**
 * A pluggable way to place the same set of nodes in space. A layout never
 * adds or removes nodes and never allocates per call — `out` is a pooled
 * buffer sized `nodes.length * 3`, resized only when the topology changes.
 * See docs/CONSTELLATION.md.
 */
export interface GraphLayout {
  readonly id: string;
  /** Fill `out` with xyz per node. Must be deterministic for a given topology. */
  generate(topology: GraphTopology, current: Float32Array, out: Float32Array): void;
}
