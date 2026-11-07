import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Small app-level config persisted in Electron's `userData` directory (NOT
 * inside the vault folder itself) — enough to reopen the same vault folder
 * next launch without re-showing the folder-pick dialog, plus the recent-
 * vaults list the Phase 20b vault switcher (VaultSwitcher.tsx) reads from.
 * `recentVaults` is most-recent-first, de-duped by path, capped at
 * `MAX_RECENT_VAULTS`. */
export interface DesktopConfig {
  currentVaultPath: string | null;
  recentVaults: string[];
}

/** Phase 20a's config shape — a single optional path, nothing else. Still
 * read (and upgraded on the fly) so an existing user's `desktop-config.json`
 * from before this phase keeps working instead of losing their vault. */
interface LegacyDesktopConfig {
  vaultPath?: string;
}

const CONFIG_FILE_NAME = "desktop-config.json";
export const MAX_RECENT_VAULTS = 10;
const EMPTY_CONFIG: DesktopConfig = { currentVaultPath: null, recentVaults: [] };

function configPath(userDataDir: string): string {
  return path.join(userDataDir, CONFIG_FILE_NAME);
}

/** `path.normalize` alone keeps a trailing separator (`"/vault/"` stays
 * `"/vault/"`), so it's stripped here too — otherwise a vault opened once via
 * a dialog (no trailing slash) and once via a differently-formatted path
 * would show up as two separate recent-vault entries. The root path itself
 * (`"/"`) is left alone. */
function normalizeVaultPath(vaultPath: string): string {
  const normalized = path.normalize(vaultPath).replace(/\\/g, "/");
  const stripped = normalized.replace(/\/+$/, "");
  return stripped === "" ? normalized : stripped;
}

/** De-dupes a list of vault paths, keeping only the first (most-recent)
 * occurrence of each — paths are compared via `normalizeVaultPath` so e.g.
 * `"/vault/"` and `"/vault"` collapse to one entry. Order is otherwise
 * preserved, so callers control recency by what order they pass in. */
export function dedupeVaultPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const normalized = normalizeVaultPath(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Adds (or, if already present, promotes) `vaultPath` to the front of
 * `recentVaults`, de-duping and capping the result at `max` entries — the
 * single pure function driving "switching to a vault makes it the most
 * recent one" for both the switcher's recent-vault clicks and
 * create/open/switch in main.ts. */
export function promoteRecentVault(
  recentVaults: string[],
  vaultPath: string,
  max: number = MAX_RECENT_VAULTS,
): string[] {
  return dedupeVaultPaths([vaultPath, ...recentVaults]).slice(0, max);
}

/** Removes `vaultPath` from `recentVaults`, if present — not currently wired
 * to any IPC handler (there's no "forget this vault" UI yet) but kept as a
 * pure helper alongside `promoteRecentVault` since the switcher is a natural
 * place to add one later. */
export function removeRecentVault(recentVaults: string[], vaultPath: string): string[] {
  const normalized = normalizeVaultPath(vaultPath);
  return recentVaults.filter((p) => normalizeVaultPath(p) !== normalized);
}

/** Upgrades whatever shape was on disk (this phase's, or Phase 20a's
 * single-path shape) into the current `DesktopConfig`. Also defends against
 * a hand-edited or partially-written file missing fields outright. */
function normalizeConfig(parsed: Partial<DesktopConfig> & LegacyDesktopConfig): DesktopConfig {
  if (Array.isArray(parsed.recentVaults) || typeof parsed.currentVaultPath !== "undefined") {
    const currentVaultPath = parsed.currentVaultPath ?? null;
    const base = Array.isArray(parsed.recentVaults)
      ? parsed.recentVaults
      : currentVaultPath
        ? [currentVaultPath]
        : [];
    return {
      currentVaultPath,
      recentVaults: dedupeVaultPaths(base),
    };
  }
  if (parsed.vaultPath) {
    return { currentVaultPath: parsed.vaultPath, recentVaults: [normalizeVaultPath(parsed.vaultPath)] };
  }
  return { ...EMPTY_CONFIG };
}

export async function readConfig(userDataDir: string): Promise<DesktopConfig> {
  try {
    const raw = await readFile(configPath(userDataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<DesktopConfig> & LegacyDesktopConfig;
    return normalizeConfig(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_CONFIG };
    throw err;
  }
}

export async function writeConfig(userDataDir: string, config: DesktopConfig): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  const target = configPath(userDataDir);
  // Same atomic temp-file-then-rename approach as FilesystemVaultAdapter
  // (see filesystemVault.ts) — small file, but a torn write here would lose
  // track of the user's vault folder, so it's worth the same care.
  const tmpPath = path.join(userDataDir, `.${CONFIG_FILE_NAME}.${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
  await rename(tmpPath, target);
}
