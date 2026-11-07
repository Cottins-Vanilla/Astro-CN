import { describe, expect, it } from "vitest";
import { translateClusterMembers } from "../GraphView3D";

describe("translateClusterMembers", () => {
  it("translates every listed member by the same delta", () => {
    // 3 nodes, all members of the drag.
    const positions = new Float32Array([0, 0, 0, 10, 20, 30, -5, 5, -5]);
    translateClusterMembers(positions, [0, 1, 2], 1, 2, 3);
    expect(Array.from(positions)).toEqual([1, 2, 3, 11, 22, 33, -4, 7, -2]);
  });

  it("leaves every node NOT in members untouched", () => {
    // 4 nodes; only 0 and 2 belong to the dragged cluster.
    const positions = new Float32Array([0, 0, 0, 100, 100, 100, 5, 5, 5, 200, 200, 200]);
    const before = positions.slice();
    translateClusterMembers(positions, [0, 2], 10, -10, 1);
    expect(Array.from(positions.slice(0, 3))).toEqual([10, -10, 1]);
    expect(Array.from(positions.slice(6, 9))).toEqual([15, -5, 6]);
    // Untouched members (index 1 and 3) keep their exact original positions.
    expect(Array.from(positions.slice(3, 6))).toEqual(Array.from(before.slice(3, 6)));
    expect(Array.from(positions.slice(9, 12))).toEqual(Array.from(before.slice(9, 12)));
  });

  it("a zero delta is a true no-op", () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const before = positions.slice();
    translateClusterMembers(positions, [0, 1], 0, 0, 0);
    expect(Array.from(positions)).toEqual(Array.from(before));
  });
});
