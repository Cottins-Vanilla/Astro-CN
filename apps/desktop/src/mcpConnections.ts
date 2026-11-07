import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMPTY_PROBES, matchesAny, type DetectionProbes } from "./clientDetect.js";

/**
 * Settings → Connections: wires Astro's existing MCP server (packages/mcp-server) into the config
 * files of locally installed AI agents, so they can read/write the open vault directly instead of
 * being told to paste notes in by hand. Local only — no accounts, no network calls. The entry
 * written names only the server; no vault path is stored, because the server resolves Astro's
 * currently-open vault itself (packages/mcp-server/src/currentVault.ts).
 *
 * Split into two tables:
 * - `VERIFIED_CLIENTS`: config file path + format confirmed on a real machine — Astro may read,
 *   merge, and write these.
 * - `UNVERIFIED_CLIENTS`: path and/or schema NOT confirmed — Astro must never write these. The UI
 *   shows a copyable snippet and a note instead. Blind-writing an unverified file's schema can break
 *   the user's other tooling, which is the entire reason this split exists.
 */

export type ClientId =
  | "claude-code"
  | "codex"
  | "claude-desktop"
  | "cursor"
  | "antigravity"
  | "goose"
  | "cline"
  | "pi";

/** Home/appData roots, passed in rather than read from `os`/`process.env` directly so tests can
 * point every client's config path at a temp directory instead of the real machine. */
export interface PathRoots {
  home: string;
  appData: string;
  localAppData: string;
  /** `%PROGRAMDATA%` — the all-users Start Menu lives here, which is where a machine-wide install
   * puts its shortcut. See clientDetect.ts. */
  programData: string;
}

export interface VerifiedClientDef {
  id: ClientId;
  name: string;
  verified: true;
  format: "json" | "toml" | "yaml";
  /** Top-level key holding the server map — `mcpServers` for every JSON client, `mcp_servers` for
   * Codex's TOML (`[mcp_servers.astro]`), `extensions` for Goose's YAML. */
  serverKey: string;
  /** Candidate config locations, most specific first. `resolveConfigPath` takes the first that
   * exists, falling back to `[0]` when none do (that's the one a fresh install would create).
   * A list, not a single path, because one client can have several install flavours whose config
   * lands in completely different places — Claude Desktop ships both a plain Windows installer and
   * a Store/MSIX package, and the MSIX one redirects `%APPDATA%` into its own package container. */
  configPaths: (roots: PathRoots) => string[];
  /** Paths that exist only when the client itself is really installed — deliberately NOT its config
   * file or config folder, which survive an uninstall (this machine still has a full
   * `%APPDATA%\Cursor` profile and a `~/.cursor` folder from a Cursor that is long gone) and are
   * also absent on a fresh install that hasn't written its config yet. Any one match counts.
   * Advisory only: no probe covers every install method, so a miss never blocks Connect. */
  installedPaths: (roots: PathRoots) => string[];
  /** Substrings matched against every `DisplayName` in Windows' uninstall registry — where a
   * conventional installer records itself no matter which directory it chose, so this catches the
   * installs `installedPaths` cannot enumerate. See clientDetect.ts. */
  uninstallNames?: string[];
  /** Substrings matched against Start Menu shortcut names (user and all-users). */
  startMenuNames?: string[];
}

/** Package family name of Claude Desktop's Microsoft Store (MSIX) build — `Name_PublisherHash`,
 * where the hash is derived from the publisher in the manifest, so it is the same on every machine.
 * An MSIX app gets a redirected profile, so its config is under the package container rather than
 * the real `%APPDATA%`, and it registers no uninstall key and no Start Menu shortcut — which is why
 * probing those three said "not installed" on a machine that had the app pinned to its taskbar. */
const CLAUDE_DESKTOP_MSIX_FAMILY = "Claude_pzs8sxrjxfjjc";

function claudeDesktopMsixDir(r: PathRoots): string {
  return path.join(r.localAppData, "Packages", CLAUDE_DESKTOP_MSIX_FAMILY);
}

export interface UnverifiedClientDef {
  id: ClientId;
  name: string;
  verified: false;
  /** Best-guess path to show the user, or `null` when even that isn't known. */
  pathHint: string | null;
  note: string;
  snippetFormat: "json" | "none";
}

export const VERIFIED_CLIENTS: VerifiedClientDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    verified: true,
    format: "json",
    serverKey: "mcpServers",
    configPaths: (r) => [path.join(r.home, ".claude.json")],
    installedPaths: (r) => [path.join(r.home, ".claude")],
  },
  {
    // Same runtime backs both the Codex CLI and the ChatGPT desktop app on this machine — its
    // config.toml carries `[marketplaces.openai-primary-runtime]` and
    // `[plugins."documents@openai-primary-runtime"]` alongside `[mcp_servers.*]`, confirmed on disk.
    id: "codex",
    name: "Codex / ChatGPT",
    verified: true,
    format: "toml",
    serverKey: "mcp_servers",
    configPaths: (r) => [path.join(r.home, ".codex", "config.toml")],
    installedPaths: (r) => [path.join(r.home, ".codex", "sessions"), path.join(r.home, ".codex", "auth.json")],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    verified: true,
    format: "json",
    serverKey: "mcpServers",
    // Store/MSIX build first — its redirected `%APPDATA%` is the only place it reads, so writing the
    // plain path below would leave the app seeing no MCP server at all. Confirmed on disk.
    configPaths: (r) => [
      path.join(claudeDesktopMsixDir(r), "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"),
      path.join(r.appData, "Claude", "claude_desktop_config.json"),
      path.join(r.home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    ],
    // NOT `%LOCALAPPDATA%\Claude` — that one is the Claude-in-Chrome native messaging host's log
    // folder and exists without the desktop app ever being installed.
    installedPaths: (r) => [
      claudeDesktopMsixDir(r),
      path.join(r.localAppData, "AnthropicClaude"),
      path.join(r.home, "Applications", "Claude.app"),
      "/Applications/Claude.app",
    ],
    // The MSIX build registers neither, which is exactly why the package directory above is
    // probed first — but the plain Windows installer does register both.
    uninstallNames: ["claude"],
    startMenuNames: ["claude"],
  },
  {
    id: "cursor",
    name: "Cursor",
    verified: true,
    format: "json",
    serverKey: "mcpServers",
    configPaths: (r) => [path.join(r.home, ".cursor", "mcp.json")],
    // The executable, not `~/.cursor` — that folder is a leftover on this very machine, from a
    // Cursor that was uninstalled long ago, and counting it would report an app that is not there.
    // Per-user install (the default), machine-wide install, the updater folder, and macOS.
    installedPaths: (r) => [
      path.join(r.localAppData, "Programs", "cursor", "Cursor.exe"),
      path.join(r.localAppData, "cursor-updater"),
      path.join("C:\\", "Program Files", "Cursor", "Cursor.exe"),
      path.join(r.home, "Applications", "Cursor.app"),
      "/Applications/Cursor.app",
      path.join(r.home, ".local", "share", "cursor"),
    ],
    uninstallNames: ["cursor"],
    startMenuNames: ["cursor"],
  },
  {
    // Path and schema confirmed from Antigravity's own shipped docs (not guessed):
    // ~/.gemini/antigravity/builtin/skills/agy-customizations/docs/mcp_servers.md — same
    // mcpServers JSON shape as the other verified JSON clients, so no new format branch needed.
    id: "antigravity",
    name: "Antigravity",
    verified: true,
    format: "json",
    serverKey: "mcpServers",
    configPaths: (r) => [path.join(r.home, ".gemini", "config", "mcp_config.json")],
    installedPaths: (r) => [path.join(r.home, ".gemini", "antigravity")],
  },
  {
    // Path and schema confirmed on a real machine: %APPDATA%\Block\goose\config\config.yaml exists
    // and its `extensions:` map holds Goose's builtin tools (developer, computercontroller, ...);
    // the shape for a custom stdio entry (name/cmd/args/enabled/type/timeout) is from Goose's own
    // docs. macOS/Linux config path per those same docs.
    id: "goose",
    name: "Goose",
    verified: true,
    format: "yaml",
    serverKey: "extensions",
    configPaths: (r) => [
      path.join(r.appData, "Block", "goose", "config", "config.yaml"),
      path.join(r.home, ".config", "goose", "config.yaml"),
    ],
    // NOT the config folder — survives an uninstall. `data\sessions` and `data` both exist on this
    // machine and only appear once Goose has actually run.
    installedPaths: (r) => [
      path.join(r.appData, "Block", "goose", "data", "sessions"),
      path.join(r.appData, "Block", "goose", "data"),
      path.join(r.home, ".local", "share", "goose", "sessions"),
      path.join(r.home, ".local", "share", "goose"),
    ],
    uninstallNames: ["goose"],
    startMenuNames: ["goose"],
  },
];

export const UNVERIFIED_CLIENTS: UnverifiedClientDef[] = [
  {
    id: "cline",
    name: "Cline",
    verified: false,
    pathHint: null,
    note: "Cline 的配置文件 cline_mcp_settings.json 位于 VS Code 的全局存储目录，具体位置取决于安装版本。请打开该文件，将下方内容添加到 mcpServers 中。",
    snippetFormat: "json",
  },
  {
    id: "pi",
    name: "Pi",
    verified: false,
    pathHint: "~/.pi/agent/settings.json",
    note: "打开 settings.json，将下方内容添加到 mcpServers 配置项中；若该项不存在，请先创建。",
    snippetFormat: "json",
  },
];

/** What Astro can actually observe: whether the `astro` entry is in that client's config file.
 * The old "connected"/"not-installed" wording claimed more than that — it read as a statement
 * about the client's runtime, so a config file written for an uninstalled Cursor reported
 * "Connected", and a Claude Desktop that simply hadn't written its config yet reported
 * "Not installed" and had its button disabled. */
export type ClientState = "configured" | "not-configured";

export interface ClientStatus {
  id: ClientId;
  name: string;
  state: ClientState;
  /** True when one of `installedPaths` exists. Advisory: shown as a hint, never a blocker. */
  detected: boolean;
  /** The exact file Astro writes, surfaced in the UI so "configured" is a claim the user can check. */
  configPath: string;
  /** Configured, but the entry in the file is not what Astro would write now (old path, leftover
   * --vault argument). The client is pointed at something stale and needs re-adding. */
  stale?: boolean;
  /** Set when the existing config file failed to parse — Connect/Disconnect must stay disabled,
   * since a write would need to parse it too. */
  error?: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The config file to read and write for this client: the first candidate that already exists, or
 * `[0]` when none do — the location a fresh install of the preferred flavour would use. */
export async function resolveConfigPath(client: VerifiedClientDef, roots: PathRoots): Promise<string> {
  const candidates = client.configPaths(roots);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return candidates[0];
}

/** TOML basic-string escaping — just the two characters that matter for a filesystem path
 * (backslash, quote). Not a general TOML escaper; there's no library dependency here on purpose
 * (see the module comment), so this only covers what `node`/entry/vault paths can contain. */
function tomlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Finds the `[header]` table in a TOML file by exact line match and returns `{ start, end }` line
 * indices (end exclusive) spanning up to the next top-level `[...]` header or EOF — everything a
 * single flat `[mcp_servers.astro]` block (`command`/`args`, no nested subtables) can contain. */
function findTomlSection(lines: string[], header: string): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("[")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function tomlSectionText(raw: string, header: string): string | null {
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const found = findTomlSection(lines, header);
  return found ? lines.slice(found.start, found.end).join("\n") : null;
}

/** Splices a single `[mcp_servers.astro]`-style section into (or out of) a TOML file via plain
 * line manipulation — see the module comment for why this avoids a TOML library. `replacement`
 * (including its own header line, trailing newline) replaces the section in place, or appends one
 * if absent; `null` removes an existing section and is a no-op if it isn't there. */
function spliceTomlSection(raw: string, header: string, replacement: string | null): string {
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const found = findTomlSection(lines, header);
  if (!found) {
    if (replacement === null) return raw;
    const sep = raw.length === 0 ? "" : raw.endsWith("\n") ? "\n" : "\n\n";
    return raw + sep + replacement;
  }
  const before = lines.slice(0, found.start);
  const after = lines.slice(found.end);
  const replacementLines = replacement === null ? [] : replacement.replace(/\n$/, "").split("\n");
  return [...before, ...replacementLines, ...after].join("\n");
}

/** The `[mcp_servers.astro]` section text Astro would write for `entryPath` — shared by
 * `mergeTomlConfig` and `getClientStatus`'s stale check so they can never drift apart. */
function astroTomlSection(entryPath: string): string {
  return `[mcp_servers.astro]\ncommand = "node"\nargs = ["${tomlEscape(entryPath)}"]\n`;
}

function mergeTomlConfig(raw: string, entryPath: string): string {
  return spliceTomlSection(raw, "[mcp_servers.astro]", astroTomlSection(entryPath));
}

function removeTomlSection(raw: string): string {
  return spliceTomlSection(raw, "[mcp_servers.astro]", null);
}

/** Fallback indent (spaces) for a child key when its parent block has no children yet to detect one
 * from — e.g. a freshly-appended, empty `extensions:`. */
const DEFAULT_YAML_CHILD_INDENT = 2;

/** Same two characters as `tomlEscape`; YAML double-quoted scalars use the same escapes. */
function yamlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Indentation (spaces) of a line, or `null` for a blank line — blank lines never count as ending a
 * block or as a sibling. */
function yamlIndent(line: string): number | null {
  return line.trim() === "" ? null : line.match(/^ */)![0].length;
}

/** Finds a top-level `key:` line (column 0, exact) and its block's line range — up to the next
 * non-blank column-0 line, or EOF. Mirrors `findTomlSection`'s header search, but YAML nests via
 * indentation instead of `[headers]`. */
function findYamlBlock(lines: string[], key: string): { start: number; end: number } | null {
  // Column 0 exactly, not `trim()`: a nested `extensions:` under some other top-level key would
  // otherwise match, and everything below would be spliced relative to the wrong block — in a file
  // Astro writes back to disk.
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (yamlIndent(lines[i]) === 0) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Indentation of this block's children — the first non-blank line's indent within (start, end), or
 * `null` when the block has no children yet. Detected per-file rather than assumed, so a config
 * that indents `extensions:` children by 4 spaces round-trips at 4, not 2. */
function yamlChildIndent(lines: string[], start: number, end: number): number | null {
  for (let i = start + 1; i < end; i++) {
    const ind = yamlIndent(lines[i]);
    if (ind !== null) return ind;
  }
  return null;
}

/** Finds a child key at exactly `indent` spaces within (start, end) — e.g. `astro:` under
 * `extensions:` — bounded by the next line at indent <= `indent` (a sibling key, or dedent out of
 * the block entirely), or `end`. */
function findYamlChild(lines: string[], start: number, end: number, indent: number, key: string): { start: number; end: number } | null {
  const marker = `${" ".repeat(indent)}${key}:`;
  let childStart = -1;
  for (let i = start + 1; i < end; i++) {
    if (lines[i] === marker) {
      childStart = i;
      break;
    }
  }
  if (childStart === -1) return null;
  let childEnd = end;
  for (let i = childStart + 1; i < end; i++) {
    const ind = yamlIndent(lines[i]);
    if (ind !== null && ind <= indent) {
      childEnd = i;
      break;
    }
  }
  return { start: childStart, end: childEnd };
}

/** The `astro:` block text Astro would write under `extensions:` for `entryPath` at the given child
 * indent — shared by `mergeYamlConfig` and `getClientStatus`'s stale check so they can never drift
 * apart. `args` is a block sequence (not `[...]`) so a Windows path with backslashes and spaces can
 * be safely double-quoted on its own line. */
function astroYamlSection(entryPath: string, indent: number): string {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  return (
    [
      `${pad}astro:`,
      `${inner}name: astro`,
      `${inner}cmd: node`,
      `${inner}args:`,
      `${inner}  - "${yamlEscape(entryPath)}"`,
      `${inner}enabled: true`,
      `${inner}type: stdio`,
      `${inner}timeout: 300`,
    ].join("\n") + "\n"
  );
}

/** The `astro:` block currently under `topKey` in `raw`, plus the indent it's written at (needed so
 * the stale comparison builds its "current" text at the same indent instead of assuming 2). `null`
 * when `topKey` or the `astro` child is missing. */
function yamlAstroSection(raw: string, topKey: string): { text: string; indent: number } | null {
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const top = findYamlBlock(lines, topKey);
  if (!top) return null;
  const indent = yamlChildIndent(lines, top.start, top.end) ?? DEFAULT_YAML_CHILD_INDENT;
  const child = findYamlChild(lines, top.start, top.end, indent, "astro");
  return child ? { text: lines.slice(child.start, child.end).join("\n"), indent } : null;
}

/** Splices the `astro:` child block into (or out of) `topKey:` (Goose's `extensions:`) via plain
 * line manipulation — see the module comment for why this avoids a YAML library. Never touches any
 * other child of `topKey`, or reformats the file. `entryPath` of `null` removes an existing block (a
 * no-op if it isn't there); otherwise inserts one or replaces it in place at its existing indent. */
function spliceYamlAstroBlock(raw: string, topKey: string, entryPath: string | null): string {
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const top = findYamlBlock(lines, topKey);

  if (!top) {
    if (entryPath === null) return raw;
    const sep = raw.length === 0 ? "" : raw.endsWith("\n") ? "\n" : "\n\n";
    return raw + sep + `${topKey}:\n` + astroYamlSection(entryPath, DEFAULT_YAML_CHILD_INDENT);
  }

  const indent = yamlChildIndent(lines, top.start, top.end) ?? DEFAULT_YAML_CHILD_INDENT;
  const child = findYamlChild(lines, top.start, top.end, indent, "astro");

  if (entryPath === null) {
    if (!child) return raw;
    return [...lines.slice(0, child.start), ...lines.slice(child.end)].join("\n");
  }

  const blockLines = astroYamlSection(entryPath, indent).replace(/\n$/, "").split("\n");
  const insertAt = child ? child.start : top.start + 1;
  const removeUntil = child ? child.end : top.start + 1;
  return [...lines.slice(0, insertAt), ...blockLines, ...lines.slice(removeUntil)].join("\n");
}

function mergeYamlConfig(raw: string, serverKey: string, entryPath: string): string {
  return spliceYamlAstroBlock(raw, serverKey, entryPath);
}

function removeYamlSection(raw: string, serverKey: string): string {
  return spliceYamlAstroBlock(raw, serverKey, null);
}

/** Parses a config file's contents as a JSON object. A zero-byte or whitespace-only file (e.g. a
 * freshly created `mcp_config.json` that nothing has written to yet) means "no servers yet", not
 * malformed JSON, so it's treated as `{}` rather than thrown at `JSON.parse`. Throws for genuinely
 * invalid JSON or a non-object root; callers must not write on that path. */
function parseJsonConfig(raw: string): Record<string, unknown> {
  const obj = raw.trim().length === 0 ? {} : (JSON.parse(raw) as Record<string, unknown>);
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("配置文件的最外层必须是 JSON 对象");
  }
  return obj;
}

/** Merges only the single `astro` key into `obj[serverKey]`, leaving every other server (and every
 * other top-level key) exactly as parsed — never rebuilds the file from a template. Throws if `raw`
 * isn't valid JSON or its root isn't a plain object; callers must not write on that path. */
function mergeJsonConfig(raw: string, serverKey: string, entryPath: string): string {
  const obj = parseJsonConfig(raw);
  const servers = typeof obj[serverKey] === "object" && obj[serverKey] !== null ? (obj[serverKey] as Record<string, unknown>) : {};
  // No `--vault`: the server resolves Astro's currently-open vault itself (packages/mcp-server's
  // currentVault.ts). Writing the path here froze whichever vault happened to be open at Connect
  // time into every client's config, so switching vaults in the app silently stranded the agent
  // on the old one.
  servers.astro = { command: "node", args: [entryPath] };
  obj[serverKey] = servers;
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function removeJsonEntry(raw: string, serverKey: string): string {
  const obj = parseJsonConfig(raw);
  const servers = obj[serverKey];
  if (typeof servers === "object" && servers !== null) {
    delete (servers as Record<string, unknown>).astro;
  }
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** Files on disk, the uninstall registry, or a Start Menu shortcut — any one match counts. See
 * clientDetect.ts for why all three, and why a miss is never a blocker. */
async function isDetected(client: VerifiedClientDef, roots: PathRoots, probes: DetectionProbes): Promise<boolean> {
  const hits = await Promise.all(client.installedPaths(roots).map(fileExists));
  if (hits.some(Boolean)) return true;
  if (client.uninstallNames && matchesAny(probes.uninstallNames, client.uninstallNames)) return true;
  if (client.startMenuNames && matchesAny(probes.startMenuShortcuts, client.startMenuNames)) return true;
  return false;
}

/** Whether a JSON client's stored `astro` entry is exactly what `mergeJsonConfig` would write today
 * — a leftover `--vault` arg or an entryPath from a dist that has since moved both fail this. */
function isCurrentJsonEntry(entry: unknown, entryPath: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as { command?: unknown; args?: unknown };
  return e.command === "node" && Array.isArray(e.args) && e.args.length === 1 && e.args[0] === entryPath;
}

export async function getClientStatus(
  client: VerifiedClientDef,
  roots: PathRoots,
  entryPath: string | null,
  probes: DetectionProbes = EMPTY_PROBES,
): Promise<ClientStatus> {
  const configPath = await resolveConfigPath(client, roots);
  const base = { id: client.id, name: client.name, configPath, detected: await isDetected(client, roots, probes) };

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...base, state: "not-configured" };
    throw err;
  }

  if (client.format === "json") {
    try {
      const obj = parseJsonConfig(raw);
      const servers = obj[client.serverKey] as Record<string, unknown> | undefined;
      // Presence of the `astro` entry is the whole test for "configured". It used to also require
      // the current vault path among the args, which made a client read as unconfigured purely
      // because the user had switched vaults since pressing Connect.
      const entry = servers?.astro;
      const state: ClientState = entry ? "configured" : "not-configured";
      // No entryPath (server not built) means nothing to compare against — stale stays undefined.
      const stale = state === "configured" && entryPath !== null ? !isCurrentJsonEntry(entry, entryPath) : undefined;
      return { ...base, state, stale };
    } catch (err) {
      return {
        ...base,
        state: "not-configured",
        error: `原配置文件的 JSON 格式有误，未作修改。（${(err as Error).message})`,
      };
    }
  }

  if (client.format === "yaml") {
    const section = yamlAstroSection(raw, client.serverKey);
    const state: ClientState = section ? "configured" : "not-configured";
    const stale =
      state === "configured" && entryPath !== null
        ? section!.text.trim() !== astroYamlSection(entryPath, section!.indent).trim()
        : undefined;
    return { ...base, state, stale };
  }

  const section = tomlSectionText(raw, `[${client.serverKey}.astro]`);
  const state: ClientState = section ? "configured" : "not-configured";
  const stale =
    state === "configured" && entryPath !== null ? section!.trim() !== astroTomlSection(entryPath).trim() : undefined;
  return { ...base, state, stale };
}

/** Copies the config file to `<file>.astro-backup` before its first-ever write by this feature — a
 * no-op if that backup already exists (only the pristine, pre-Astro version is worth keeping) or if
 * the file doesn't exist yet (nothing to back up; this write will create it).
 *
 * Also skipped when the file already carries Astro's own entry: connect → disconnect → connect
 * otherwise took a "backup" of a file Astro itself had created, which is not a pre-Astro state and
 * is exactly what a real machine ended up with. */
async function backupIfNeeded(client: VerifiedClientDef, filePath: string, currentRaw: string): Promise<void> {
  const backupPath = `${filePath}.astro-backup`;
  if (await fileExists(backupPath)) return;
  if (!(await fileExists(filePath))) return;
  if (hasAstroEntry(client, currentRaw)) return;
  await copyFile(filePath, backupPath);
}

function hasAstroEntry(client: VerifiedClientDef, raw: string): boolean {
  if (client.format === "yaml") return !!yamlAstroSection(raw, client.serverKey);
  if (client.format !== "json") return !!tomlSectionText(raw, `[${client.serverKey}.astro]`);
  try {
    const servers = parseJsonConfig(raw)[client.serverKey] as Record<string, unknown> | undefined;
    return !!servers?.astro;
  } catch {
    return false;
  }
}

export async function connectClient(
  client: VerifiedClientDef,
  roots: PathRoots,
  entryPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const filePath = await resolveConfigPath(client, roots);
  const raw = (await fileExists(filePath)) ? await readFile(filePath, "utf8") : client.format === "json" ? "{}" : "";

  let updated: string;
  try {
    updated =
      client.format === "json"
        ? mergeJsonConfig(raw, client.serverKey, entryPath)
        : client.format === "yaml"
          ? mergeYamlConfig(raw, client.serverKey, entryPath)
          : mergeTomlConfig(raw, entryPath);
  } catch (err) {
    return { ok: false, error: `原配置文件的 JSON 格式有误，未作修改。（${(err as Error).message})` };
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await backupIfNeeded(client, filePath, raw);
  await writeFile(filePath, updated, "utf8");
  return { ok: true };
}

export async function disconnectClient(client: VerifiedClientDef, roots: PathRoots): Promise<{ ok: true } | { ok: false; error: string }> {
  const filePath = await resolveConfigPath(client, roots);
  if (!(await fileExists(filePath))) return { ok: true };

  const raw = await readFile(filePath, "utf8");
  let updated: string;
  try {
    updated =
      client.format === "json"
        ? removeJsonEntry(raw, client.serverKey)
        : client.format === "yaml"
          ? removeYamlSection(raw, client.serverKey)
          : removeTomlSection(raw);
  } catch (err) {
    return { ok: false, error: `原配置文件的 JSON 格式有误，未作修改。（${(err as Error).message})` };
  }

  await backupIfNeeded(client, filePath, raw);
  await writeFile(filePath, updated, "utf8");
  return { ok: true };
}
