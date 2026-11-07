import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Whether an AI client is really installed on this machine.
 *
 * The first version of this asked one question per client — "does this one folder exist?" — which
 * is not a search, it is a guess, and it got the answer wrong in both directions: a config folder
 * left behind by an uninstall counted as installed, and an app installed anywhere but the one
 * hard-coded folder counted as missing.
 *
 * So this gathers, once, the three places a Windows program can actually be found, and each client
 * says which of them should match it:
 *
 * 1. **Files on disk** — the executable or a runtime data folder (`installedPaths`). Deliberately
 *    never a config file or config folder: those survive an uninstall and are absent on a fresh
 *    install that hasn't run yet.
 * 2. **The uninstall registry** — where every conventional Windows installer records itself, per
 *    user *and* machine-wide, whatever directory it chose. Read through `reg.exe`, the only
 *    dependency-free way in.
 * 3. **Start Menu shortcuts** — user and all-users, which catches installs whose registry entry is
 *    under a name nobody would guess.
 *
 * Any single match counts. Still advisory: no probe covers every install method (portable builds,
 * MSIX packages, WSL), so a miss never blocks the Add button — it only changes what the row says.
 */
export interface DetectionProbes {
  /** Every `DisplayName` in the uninstall registry, lowercased. Empty off Windows or on failure. */
  uninstallNames: string[];
  /** Every `.lnk` basename under both Start Menus, without extension, lowercased. */
  startMenuShortcuts: string[];
}

export const EMPTY_PROBES: DetectionProbes = { uninstallNames: [], startMenuShortcuts: [] };

const UNINSTALL_KEYS = [
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

/** `reg query <key> /s /v DisplayName` output is `    DisplayName    REG_SZ    Some App`. */
const DISPLAY_NAME_LINE = /^\s*DisplayName\s+REG_\w+\s+(.+?)\s*$/gm;

async function readUninstallNames(): Promise<string[]> {
  const results = await Promise.all(
    UNINSTALL_KEYS.map(async (key) => {
      try {
        // 4 MB: the uninstall tree on a well-used machine runs to hundreds of KB, and a truncated
        // read would silently under-report rather than fail loudly.
        const { stdout } = await execFileAsync("reg", ["query", key, "/s", "/v", "DisplayName"], {
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        return [...stdout.matchAll(DISPLAY_NAME_LINE)].map((m) => m[1].toLowerCase());
      } catch {
        // Missing key, no reg.exe (not Windows), access denied — detection is advisory, so a probe
        // that cannot run contributes nothing rather than throwing.
        return [];
      }
    }),
  );
  return results.flat();
}

/** Recursively collects `.lnk` basenames under `dir`. Depth-capped: Start Menu folders are one or
 * two levels deep by convention, and an unbounded walk of a junction loop is not worth the risk. */
async function collectShortcuts(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(...(await collectShortcuts(path.join(dir, entry.name), depth + 1)));
    else if (entry.name.toLowerCase().endsWith(".lnk")) out.push(entry.name.slice(0, -4).toLowerCase());
  }
  return out;
}

/** Gathers both machine-wide probes once, for every client to be matched against. */
export async function collectDetectionProbes(roots: { appData: string; programData: string }): Promise<DetectionProbes> {
  // Both probes are Windows concepts. Off Windows they can only fail — three spawned processes
  // that error and two directory walks that miss — so skip them and let `installedPaths` (which
  // does carry macOS/Linux locations) answer alone.
  if (process.platform !== "win32") return EMPTY_PROBES;
  const startMenuDirs = [
    path.join(roots.appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(roots.programData, "Microsoft", "Windows", "Start Menu", "Programs"),
  ];
  const [uninstallNames, shortcutLists] = await Promise.all([
    readUninstallNames(),
    Promise.all(startMenuDirs.map((d) => collectShortcuts(d))),
  ]);
  return { uninstallNames, startMenuShortcuts: shortcutLists.flat() };
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** True when any `needle` appears in any `haystack` entry. Substring, not equality: installers
 * write "Cursor (User)" / "Cursor 1.7.44", and a shortcut may be "Cursor" or "Cursor IDE". */
export function matchesAny(haystack: string[], needles: string[]): boolean {
  const lowered = needles.map((n) => n.toLowerCase());
  return haystack.some((entry) => lowered.some((needle) => entry.includes(needle)));
}
