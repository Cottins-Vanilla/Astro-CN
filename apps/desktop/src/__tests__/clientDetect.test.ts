import { describe, expect, it } from "vitest";
import { matchesAny } from "../clientDetect.js";

describe("matchesAny", () => {
  it("matches an installer's decorated display name", () => {
    // What Cursor's own installer actually writes into the uninstall registry.
    expect(matchesAny(["cursor (user)"], ["cursor"])).toBe(true);
    expect(matchesAny(["cursor 1.7.44"], ["cursor"])).toBe(true);
  });

  it("matches a Start Menu shortcut under a longer name", () => {
    expect(matchesAny(["cursor ide"], ["cursor"])).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    expect(matchesAny(["goose desktop"], ["GOOSE"])).toBe(true);
  });

  it("does not match an unrelated program", () => {
    expect(matchesAny(["visual studio code", "obsidian"], ["cursor"])).toBe(false);
  });

  it("is false against an empty probe set — the off-Windows / probe-failed case", () => {
    expect(matchesAny([], ["cursor"])).toBe(false);
  });
});
