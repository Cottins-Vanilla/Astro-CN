import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR = "Astro-Chinese";
/** A `pnpm dev` run writes here instead, so testing Astro cannot rewrite the installed Astro's
 * vault list (see apps/desktop/src/main.ts). The server has to know about both, or wiring an agent
 * up while developing would silently follow the installed app's vault instead of the one on screen. */
const DEV_APP_DIR = join("@solen", "desktop-dev");
const CONFIG_FILE = "desktop-config.json";

/**
 * Astro's own `desktop-config.json`, at the location Electron's `app.getPath("userData")` resolves
 * to for the app name `@solen/desktop` (see apps/desktop/src/config.ts). This is a plain Node
 * process with no Electron to ask, so the three platform rules are mirrored here.
 *
 * Reading this file is what lets an MCP client config carry no vault path at all: the server
 * follows whatever vault the app currently has open, instead of freezing one path into every
 * client's config the moment Connect was pressed.
 */
export function desktopConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  appDir: string = APP_DIR,
): string {
  if (platform === "win32") {
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), appDir, CONFIG_FILE);
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", appDir, CONFIG_FILE);
  }
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), appDir, CONFIG_FILE);
}

/**
 * Both config locations, most recently written first — which is the only honest answer to "which
 * Astro is the user actually driving right now". Someone with the app installed *and* a dev build
 * open has two, and the live one is whichever last wrote its vault choice.
 */
export function desktopConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const mtimeOf = (p: string): number => {
    try {
      return statSync(p).mtimeMs;
    } catch {
      return -1; // missing: sorts last, and readCurrentVaultPath skips it anyway
    }
  };
  return [desktopConfigPath(env, platform, APP_DIR), desktopConfigPath(env, platform, DEV_APP_DIR)].sort(
    (a, b) => mtimeOf(b) - mtimeOf(a),
  );
}

/**
 * The vault Astro has open right now, or `undefined` if the app has never run, its config is
 * missing/corrupt, or no vault is open. Read on every call, not cached: an agent's server process
 * outlives any number of vault switches in the app.
 */
export function readCurrentVaultPath(configPath?: string): string | undefined {
  // No explicit path: try the installed app's config and the dev one, freshest first, and take the
  // first that actually names a vault. A stale config that has been emptied must not shadow the
  // live one, so this keeps looking rather than stopping at the newest file.
  const candidates = configPath ? [configPath] : desktopConfigPaths();
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const value = (parsed as { currentVaultPath?: unknown }).currentVaultPath;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
