import { describe, expect, it } from "vitest";
import { PATTERNS } from "../patterns";

/** Every star reachable from index 0 by walking `parent` pointers forward (children of `i` are
 * whichever indices name `i` as their parent). */
function reachableFromAnchor(parent: readonly number[]): Set<number> {
  const children: number[][] = parent.map(() => []);
  parent.forEach((p, i) => {
    if (p >= 0) children[p].push(i);
  });
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of children[node]) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}

function minPairwiseDistance(stars: ReadonlyArray<{ x: number; y: number }>): number {
  let min = Infinity;
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const dx = stars[i].x - stars[j].x;
      const dy = stars[i].y - stars[j].y;
      min = Math.min(min, Math.hypot(dx, dy));
    }
  }
  return min;
}

describe("PATTERNS", () => {
  it("is sorted by star count ascending", () => {
    for (let i = 1; i < PATTERNS.length; i++) {
      expect(PATTERNS[i].stars.length).toBeGreaterThanOrEqual(PATTERNS[i - 1].stars.length);
    }
  });

  for (const pattern of PATTERNS) {
    describe(pattern.id, () => {
      it("has a rooted parent tree with every star reachable from the anchor", () => {
        expect(pattern.parent[0]).toBe(-1);
        expect(pattern.parent).toHaveLength(pattern.stars.length);
        expect(reachableFromAnchor(pattern.parent).size).toBe(pattern.stars.length);
      });

      it("keeps every star within [-1.2, 1.2]", () => {
        for (const star of pattern.stars) {
          expect(Math.abs(star.x)).toBeLessThanOrEqual(1.2);
          expect(Math.abs(star.y)).toBeLessThanOrEqual(1.2);
        }
      });

      it("never places two stars closer than 0.05 apart", () => {
        expect(minPairwiseDistance(pattern.stars)).toBeGreaterThanOrEqual(0.05);
      });

      it("is not radially symmetric (asymmetry guard)", () => {
        const n = pattern.stars.length;
        const cx = pattern.stars.reduce((sum, s) => sum + s.x, 0) / n;
        const cy = pattern.stars.reduce((sum, s) => sum + s.y, 0) / n;
        const anchor = pattern.stars[0];
        const centroidDistance = Math.hypot(cx - anchor.x, cy - anchor.y);

        const xs = pattern.stars.map((s) => s.x);
        const ys = pattern.stars.map((s) => s.y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        const aspect = Math.max(width / height, height / width);

        expect(centroidDistance > 0.05 || aspect > 1.25).toBe(true);
      });
    });
  }
});
