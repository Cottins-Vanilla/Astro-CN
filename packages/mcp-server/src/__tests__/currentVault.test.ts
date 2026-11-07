import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desktopConfigPath, readCurrentVaultPath } from "../currentVault.js";

let dir: string;
let configPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "solen-current-vault-test-"));
  configPath = path.join(dir, "desktop-config.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readCurrentVaultPath", () => {
  it("returns the vault Astro has open", async () => {
    await writeFile(configPath, JSON.stringify({ currentVaultPath: "/vaults/mine", recentVaults: [] }), "utf8");
    expect(readCurrentVaultPath(configPath)).toBe("/vaults/mine");
  });

  it("returns undefined rather than throwing when there is nothing usable to read", async () => {
    // Every one of these is a state a real machine hits: app never launched, no vault open yet,
    // a half-written config. None may take the server process down — the caller falls back to
    // --vault or reports a clean error.
    expect(readCurrentVaultPath(path.join(dir, "missing.json"))).toBeUndefined();

    await writeFile(configPath, "{ not json", "utf8");
    expect(readCurrentVaultPath(configPath)).toBeUndefined();

    await writeFile(configPath, JSON.stringify({ recentVaults: [] }), "utf8");
    expect(readCurrentVaultPath(configPath)).toBeUndefined();

    await writeFile(configPath, JSON.stringify({ currentVaultPath: null }), "utf8");
    expect(readCurrentVaultPath(configPath)).toBeUndefined();
  });
});

describe("desktopConfigPath", () => {
  it("mirrors Electron's userData location per platform", () => {
    expect(desktopConfigPath({ APPDATA: "C:\\Roaming" }, "win32")).toBe(
      path.join("C:\\Roaming", "@solen", "desktop", "desktop-config.json"),
    );
    expect(desktopConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(
      path.join("/xdg", "@solen", "desktop", "desktop-config.json"),
    );
    expect(desktopConfigPath({}, "darwin")).toContain(path.join("Library", "Application Support", "@solen", "desktop"));
  });
});
