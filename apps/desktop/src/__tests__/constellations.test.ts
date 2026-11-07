import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCachedConstellationPatterns } from "../constellations.js";

let userDataDir: string;

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "solen-constellations-test-"));
});

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true });
});

describe("getCachedConstellationPatterns", () => {
  it("returns null when nothing has been cached yet", async () => {
    await expect(getCachedConstellationPatterns(userDataDir)).resolves.toBeNull();
  });

  it("returns the cached patterns when the schema version matches", async () => {
    const patterns = [{ id: "ant", name: "Antlia", stars: [{ x: 0, y: 0 }], parent: [-1] }];
    await mkdir(userDataDir, { recursive: true });
    await writeFile(
      path.join(userDataDir, "constellations.json"),
      JSON.stringify({ schemaVersion: 2, patterns }),
      "utf8",
    );
    await expect(getCachedConstellationPatterns(userDataDir)).resolves.toEqual(patterns);
  });

  it("treats a cache from an older schema version as absent, not as valid stale data", async () => {
    // Regression test: a cache written before a transform-logic fix (e.g. the 2026-07-24 switch
    // from English "Air Pump"-style names to Latin/IAU ones) must never silently keep overriding
    // an already-fixed bundled patterns.ts forever just because a file happens to exist.
    const staleData = [{ id: "ant", name: "Air Pump", stars: [{ x: 0, y: 0 }], parent: [-1] }];
    await mkdir(userDataDir, { recursive: true });
    await writeFile(
      path.join(userDataDir, "constellations.json"),
      JSON.stringify({ schemaVersion: 1, patterns: staleData }),
      "utf8",
    );
    await expect(getCachedConstellationPatterns(userDataDir)).resolves.toBeNull();
  });

  it("treats a pre-versioning cache (a bare array, no schemaVersion field at all) as absent", async () => {
    const legacyBareArray = [{ id: "ant", name: "Air Pump", stars: [{ x: 0, y: 0 }], parent: [-1] }];
    await mkdir(userDataDir, { recursive: true });
    await writeFile(path.join(userDataDir, "constellations.json"), JSON.stringify(legacyBareArray), "utf8");
    await expect(getCachedConstellationPatterns(userDataDir)).resolves.toBeNull();
  });

  it("returns null (not a throw) for a corrupted/unparseable cache file", async () => {
    await mkdir(userDataDir, { recursive: true });
    await writeFile(path.join(userDataDir, "constellations.json"), "{ not valid json", "utf8");
    await expect(getCachedConstellationPatterns(userDataDir)).resolves.toBeNull();
  });
});
