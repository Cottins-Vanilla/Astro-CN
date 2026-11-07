import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dedupeVaultPaths,
  promoteRecentVault,
  readConfig,
  removeRecentVault,
  writeConfig,
} from "../config.js";

let userDataDir: string;

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "solen-desktop-config-test-"));
});

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true });
});

describe("desktop config (vault folder + recent-vaults persistence)", () => {
  it("readConfig returns an empty registry when no config file exists yet", async () => {
    await expect(readConfig(userDataDir)).resolves.toEqual({ currentVaultPath: null, recentVaults: [] });
  });

  it("writeConfig then readConfig round-trips the current path and recent-vaults list", async () => {
    await writeConfig(userDataDir, {
      currentVaultPath: "/home/user/my-vault",
      recentVaults: ["/home/user/my-vault", "/home/user/other-vault"],
    });
    await expect(readConfig(userDataDir)).resolves.toEqual({
      currentVaultPath: "/home/user/my-vault",
      recentVaults: ["/home/user/my-vault", "/home/user/other-vault"],
    });
  });

  it("writeConfig creates userDataDir if missing, and leaves no leftover .tmp files", async () => {
    const nested = path.join(userDataDir, "nested", "userData");
    await writeConfig(nested, { currentVaultPath: "/some/vault", recentVaults: ["/some/vault"] });
    await expect(readConfig(nested)).resolves.toEqual({
      currentVaultPath: "/some/vault",
      recentVaults: ["/some/vault"],
    });

    const entries = await readdir(nested);
    expect(entries.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(entries).toEqual(["desktop-config.json"]);
  });

  it("a later writeConfig overwrites the earlier value", async () => {
    await writeConfig(userDataDir, { currentVaultPath: "/first", recentVaults: ["/first"] });
    await writeConfig(userDataDir, { currentVaultPath: "/second", recentVaults: ["/second", "/first"] });
    await expect(readConfig(userDataDir)).resolves.toEqual({
      currentVaultPath: "/second",
      recentVaults: ["/second", "/first"],
    });
  });

  it("reads a Phase 20a single-path config file, upgrading it to the registry shape", async () => {
    await writeFile(
      path.join(userDataDir, "desktop-config.json"),
      JSON.stringify({ vaultPath: "/home/user/legacy-vault" }),
      "utf8",
    );
    await expect(readConfig(userDataDir)).resolves.toEqual({
      currentVaultPath: "/home/user/legacy-vault",
      recentVaults: ["/home/user/legacy-vault"],
    });
  });

  it("reads a legacy config file with no vaultPath at all as an empty registry", async () => {
    await writeFile(path.join(userDataDir, "desktop-config.json"), JSON.stringify({}), "utf8");
    await expect(readConfig(userDataDir)).resolves.toEqual({ currentVaultPath: null, recentVaults: [] });
  });
});

describe("dedupeVaultPaths", () => {
  it("keeps the first occurrence of each path and drops later duplicates", () => {
    expect(dedupeVaultPaths(["/a", "/b", "/a", "/c", "/b"])).toEqual(["/a", "/b", "/c"]);
  });

  it("treats a trailing slash as the same path via path.normalize", () => {
    expect(dedupeVaultPaths(["/vault/", "/vault"])).toEqual(["/vault"]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeVaultPaths([])).toEqual([]);
  });
});

describe("promoteRecentVault", () => {
  it("adds a brand-new path to the front", () => {
    expect(promoteRecentVault(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("promotes an already-present path to the front instead of duplicating it", () => {
    expect(promoteRecentVault(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  });

  it("promoting the already-most-recent path is a no-op reorder", () => {
    expect(promoteRecentVault(["/a", "/b"], "/a")).toEqual(["/a", "/b"]);
  });

  it("caps the result at the given max, dropping the oldest entries", () => {
    expect(promoteRecentVault(["/a", "/b", "/c"], "/d", 3)).toEqual(["/d", "/a", "/b"]);
  });

  it("defaults the cap to MAX_RECENT_VAULTS (10)", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `/v${i}`);
    const result = promoteRecentVault(eleven, "/new");
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("/new");
    expect(result).not.toContain("/v10");
  });
});

describe("removeRecentVault", () => {
  it("removes a matching path", () => {
    expect(removeRecentVault(["/a", "/b", "/c"], "/b")).toEqual(["/a", "/c"]);
  });

  it("is a no-op when the path isn't present", () => {
    expect(removeRecentVault(["/a", "/b"], "/z")).toEqual(["/a", "/b"]);
  });

  // main.ts prunes a vault here the moment opening it fails because the folder is gone (see
  // `setVaultPath`). The path it passes comes from whatever the caller had — a switcher click
  // hands back the stored forward-slash form, but a path that reached the config from a Windows
  // dialog is backslashed. Both must match the stored entry, or the dead vault survives the prune
  // and the switcher keeps offering it.
  it("matches regardless of separator style, so the prune-on-missing path can't miss", () => {
    const stored = ["C:/Users/you/vaults/alpha", "C:/Users/you/vaults/beta"];
    expect(removeRecentVault(stored, "C:\\Users\\you\\vaults\\alpha")).toEqual([
      "C:/Users/you/vaults/beta",
    ]);
    expect(removeRecentVault(stored, "C:/Users/you/vaults/alpha/")).toEqual([
      "C:/Users/you/vaults/beta",
    ]);
  });
});
