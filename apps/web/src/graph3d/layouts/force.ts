import type { GraphPhysics } from "../physics";
import type { GraphTopology } from "../topology";
import type { GraphLayout } from "./types";

/** Reads the live d3-force-3d simulation — this layout never computes anything itself. */
export class ForceLayout implements GraphLayout {
  readonly id = "force";

  constructor(private readonly physics: GraphPhysics) {}

  generate(_topology: GraphTopology, _current: Float32Array, out: Float32Array): void {
    this.physics.copyPositionsTo(out);
  }
}
