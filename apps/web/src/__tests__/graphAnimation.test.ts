import { describe, expect, it } from "vitest";
import { animationActive } from "../store";

/**
 * The regression this guards: 2D used to *persist* Animation as off, so one trip through 2D
 * disabled the 3D auto-rotate permanently — across app restarts included. 2D suspends, it never
 * decides.
 */
describe("animationActive", () => {
  it("runs in 3D when the user wants it", () => {
    expect(animationActive(true, "3d")).toBe(true);
  });

  it("is suspended in 2D even though the preference stays on", () => {
    expect(animationActive(true, "2d")).toBe(false);
  });

  it("comes back the moment 3D returns — the preference was never overwritten", () => {
    const preference = true;
    expect(animationActive(preference, "2d")).toBe(false);
    expect(animationActive(preference, "3d")).toBe(true);
  });

  it("stays off in 3D when the user turned it off themselves", () => {
    expect(animationActive(false, "3d")).toBe(false);
  });
});
