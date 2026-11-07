import { describe, expect, it } from "vitest";
import { GraphPhysics } from "../physics";
import type { GraphTopology } from "../topology";

/** Three notes in a chain — enough for link/charge forces to have something to act on. */
function chainTopology(): GraphTopology {
  return {
    nodes: [
      { id: "a", title: "A", degree: 1, ghost: false, accent: "blue" },
      { id: "b", title: "B", degree: 2, ghost: false, accent: "blue" },
      { id: "c", title: "C", degree: 1, ghost: false, accent: "blue" },
    ],
    edges: [
      { a: 0, b: 1, source: "wikilink" },
      { a: 1, b: 2, source: "wikilink" },
    ],
    neighbors: [[1], [0, 2], [1]],
  } as GraphTopology;
}

function flatPositions(): Float32Array {
  // Coplanar (z=0) — what 2D mode leaves behind, and what a vault saved in 2D loads with.
  return new Float32Array([-40, 0, 0, 0, 30, 0, 40, 0, 0]);
}

function maxAbsZ(positions: Float32Array): number {
  let max = 0;
  for (let i = 0; i < positions.length / 3; i++) max = Math.max(max, Math.abs(positions[i * 3 + 2]));
  return max;
}

describe("GraphPhysics.setFlatten(false)", () => {
  it("gives a flat layout depth back — a coplanar layout is otherwise a permanent equilibrium in z", () => {
    const positions = flatPositions();
    const physics = new GraphPhysics(chainTopology(), positions);
    physics.setFlatten(true);
    for (let i = 0; i < 50; i++) physics.tick();

    physics.setFlatten(false);
    for (let i = 0; i < 50; i++) physics.tick();

    const out = new Float32Array(positions.length);
    physics.copyPositionsTo(out);
    expect(maxAbsZ(out)).toBeGreaterThan(1);
  });

  it("also un-flattens a sim constructed flat (a vault saved in 2D, reopened in 3D)", () => {
    const physics = new GraphPhysics(chainTopology(), flatPositions());
    physics.setFlatten(false);

    const out = new Float32Array(9);
    physics.copyPositionsTo(out);
    expect(maxAbsZ(out)).toBeGreaterThan(1);
  });

  it("leaves an already-3D layout's depth alone", () => {
    const positions = new Float32Array([-40, 0, 25, 0, 30, -60, 40, 0, 90]);
    const physics = new GraphPhysics(chainTopology(), positions);
    physics.setFlatten(false);

    const out = new Float32Array(9);
    physics.copyPositionsTo(out);
    expect(out[2]).toBe(25);
    expect(out[5]).toBe(-60);
    expect(out[8]).toBe(90);
  });
});
