import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectClient,
  disconnectClient,
  getClientStatus,
  VERIFIED_CLIENTS,
  type PathRoots,
} from "../mcpConnections.js";

const ENTRY_PATH = "/opt/astro/packages/mcp-server/dist/index.js";

const claudeCode = VERIFIED_CLIENTS.find((c) => c.id === "claude-code")!;
const codex = VERIFIED_CLIENTS.find((c) => c.id === "codex")!;
const antigravity = VERIFIED_CLIENTS.find((c) => c.id === "antigravity")!;
const goose = VERIFIED_CLIENTS.find((c) => c.id === "goose")!;

// Abridged real config.yaml from a machine with Goose installed (%APPDATA%\Block\goose\config\config.yaml).
const GOOSE_FIXTURE = `extensions:
  computercontroller:
    enabled: false
    type: builtin
    name: computercontroller
    description: General computer control tools that don't require you to be a developer or engineer.
    display_name: Computer Controller
    timeout: 300
    bundled: true
  developer:
    enabled: true
    type: platform
    name: developer
    description: Write and edit files, and execute shell commands
    display_name: Developer
    bundled: true
active_provider: local
providers:
  local:
    enabled: true
    model: unsloth/gemma-4-E4B-it-GGUF:Q4_K_M
    configured: true
GOOSE_TELEMETRY_ENABLED: false
`;

let roots: PathRoots;

beforeEach(async () => {
  const home = await mkdtemp(path.join(tmpdir(), "solen-mcp-test-"));
  roots = {
    home,
    appData: path.join(home, "AppData", "Roaming"),
    localAppData: path.join(home, "AppData", "Local"),
    programData: path.join(home, "ProgramData"),
  };
});

afterEach(async () => {
  await rm(roots.home, { recursive: true, force: true });
});

describe("connectClient (JSON, claude-code)", () => {
  it("merges into a config that already has other servers, leaving them untouched", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ mcpServers: { other: { command: "foo", args: [] } }, otherTopLevel: 1 }), "utf8");

    const result = await connectClient(claudeCode, roots, ENTRY_PATH);
    expect(result).toEqual({ ok: true });

    const written = JSON.parse(await readFile(filePath, "utf8"));
    expect(written.otherTopLevel).toBe(1);
    expect(written.mcpServers.other).toEqual({ command: "foo", args: [] });
    expect(written.mcpServers.astro).toEqual({ command: "node", args: [ENTRY_PATH] });
  });

  it("connecting twice is idempotent, and only backs up once", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ mcpServers: {} }), "utf8");

    await connectClient(claudeCode, roots, ENTRY_PATH);
    const backupAfterFirst = await readFile(`${filePath}.astro-backup`, "utf8");

    await connectClient(claudeCode, roots, ENTRY_PATH);
    const backupAfterSecond = await readFile(`${filePath}.astro-backup`, "utf8");

    const written = JSON.parse(await readFile(filePath, "utf8"));
    expect(written.mcpServers.astro).toEqual({ command: "node", args: [ENTRY_PATH] });
    // Backup is the pristine pre-Astro file, untouched by the second connect.
    expect(backupAfterFirst).toBe(JSON.stringify({ mcpServers: {} }));
    expect(backupAfterSecond).toBe(backupAfterFirst);
    expect(JSON.parse(backupAfterSecond).mcpServers.astro).toBeUndefined();

    const status = await getClientStatus(claudeCode, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
  });

  it("creates the file (and directory) from scratch when neither exists yet", async () => {
    const result = await connectClient(claudeCode, roots, ENTRY_PATH);
    expect(result).toEqual({ ok: true });
    const written = JSON.parse(await readFile(claudeCode.configPaths(roots)[0], "utf8"));
    expect(written.mcpServers.astro.args).toEqual([ENTRY_PATH]);
  });

  it("never backs up a file that already holds Astro's own entry", async () => {
    // connect → disconnect → connect on a file Astro created: the middle step leaves a real file
    // behind, so the naive "file exists and no backup yet" rule captured Astro's own output and
    // called it the pristine original.
    await connectClient(claudeCode, roots, ENTRY_PATH);
    const filePath = claudeCode.configPaths(roots)[0];
    await rm(`${filePath}.astro-backup`, { force: true });

    await connectClient(claudeCode, roots, ENTRY_PATH);
    expect(existsSync(`${filePath}.astro-backup`)).toBe(false);
  });
});

describe("disconnectClient (JSON, claude-code)", () => {
  it("removes only the astro key, leaving other servers and top-level keys alone", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ mcpServers: { other: { command: "foo", args: [] } }, otherTopLevel: 1 }),
      "utf8",
    );
    await connectClient(claudeCode, roots, ENTRY_PATH);

    const result = await disconnectClient(claudeCode, roots);
    expect(result).toEqual({ ok: true });

    const written = JSON.parse(await readFile(filePath, "utf8"));
    expect(written.mcpServers.astro).toBeUndefined();
    expect(written.mcpServers.other).toEqual({ command: "foo", args: [] });
    expect(written.otherTopLevel).toBe(1);
  });
});

describe("malformed JSON config", () => {
  it("is left byte-identical and connectClient reports an error instead of writing", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    const malformed = "{ not: valid json ";
    await writeFile(filePath, malformed, "utf8");

    const result = await connectClient(claudeCode, roots, ENTRY_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON 格式有误，未作修改/);

    expect(await readFile(filePath, "utf8")).toBe(malformed);
  });

  it("is left byte-identical and disconnectClient reports an error instead of writing", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    const malformed = "{ not: valid json ";
    await writeFile(filePath, malformed, "utf8");

    const result = await disconnectClient(claudeCode, roots);
    expect(result.ok).toBe(false);
    expect(await readFile(filePath, "utf8")).toBe(malformed);
  });
});

describe("empty existing JSON config (antigravity)", () => {
  it("treats a zero-byte file as no servers yet, not malformed JSON", async () => {
    const filePath = antigravity.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "", "utf8");

    const status = await getClientStatus(antigravity, roots, ENTRY_PATH);
    expect(status.state).toBe("not-configured");
    expect(status.error).toBeUndefined();

    const result = await connectClient(antigravity, roots, ENTRY_PATH);
    expect(result).toEqual({ ok: true });

    const written = JSON.parse(await readFile(filePath, "utf8"));
    expect(written.mcpServers.astro).toEqual({ command: "node", args: [ENTRY_PATH] });
  });
});

describe("TOML splice (codex)", () => {
  it("connectClient adds only its own [mcp_servers.astro] section", async () => {
    const filePath = codex.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    const existing = '[mcp_servers.other]\ncommand = "foo"\nargs = []\n';
    await writeFile(filePath, existing, "utf8");

    await connectClient(codex, roots, ENTRY_PATH);
    const written = await readFile(filePath, "utf8");

    expect(written).toContain('[mcp_servers.other]\ncommand = "foo"\nargs = []');
    expect(written).toContain("[mcp_servers.astro]");
    expect(written).toContain(`args = ["${ENTRY_PATH}"]`);

    const status = await getClientStatus(codex, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
  });

  it("disconnectClient removes only its own section, leaving the other one intact", async () => {
    const filePath = codex.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '[mcp_servers.other]\ncommand = "foo"\nargs = []\n', "utf8");
    await connectClient(codex, roots, ENTRY_PATH);

    await disconnectClient(codex, roots);
    const written = await readFile(filePath, "utf8");

    expect(written).toContain('[mcp_servers.other]');
    expect(written).not.toContain("[mcp_servers.astro]");
  });
});

describe("getClientStatus", () => {
  it("reports not-configured, and stays actionable, when nothing exists yet", async () => {
    const cursor = VERIFIED_CLIENTS.find((c) => c.id === "cursor")!;
    const status = await getClientStatus(cursor, roots, ENTRY_PATH);
    expect(status.state).toBe("not-configured");
    expect(status.detected).toBe(false);
    expect(status.error).toBeUndefined();
    expect(status.configPath).toBe(cursor.configPaths(roots)[0]);
  });

  it("detects a client from its install path, not from its config folder", async () => {
    const cursor = VERIFIED_CLIENTS.find((c) => c.id === "cursor")!;
    // A config folder left behind by an uninstalled client must NOT read as installed — exactly the
    // state a real machine was in, which made Cursor look present when it had long been removed.
    await mkdir(path.dirname(cursor.configPaths(roots)[0]), { recursive: true });
    expect((await getClientStatus(cursor, roots, ENTRY_PATH)).detected).toBe(false);

    await mkdir(cursor.installedPaths(roots)[0], { recursive: true });
    expect((await getClientStatus(cursor, roots, ENTRY_PATH)).detected).toBe(true);
  });

  it("reports not-configured when the file exists but no astro entry does", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ mcpServers: {} }), "utf8");
    const status = await getClientStatus(claudeCode, roots, ENTRY_PATH);
    expect(status.state).toBe("not-configured");
  });
});

describe("stale detection", () => {
  it("flags a leftover --vault argument from an older version as stale", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ mcpServers: { astro: { command: "node", args: [ENTRY_PATH, "--vault", "/old/vault"] } } }),
      "utf8",
    );
    const status = await getClientStatus(claudeCode, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
    expect(status.stale).toBe(true);
  });

  it("flags an entryPath from a dist that has moved as stale", async () => {
    const filePath = claudeCode.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ mcpServers: { astro: { command: "node", args: ["/old/dist/index.js"] } } }), "utf8");
    const status = await getClientStatus(claudeCode, roots, ENTRY_PATH);
    expect(status.stale).toBe(true);
  });

  it("reads falsy for the current shape written by connectClient", async () => {
    await connectClient(claudeCode, roots, ENTRY_PATH);
    const status = await getClientStatus(claudeCode, roots, ENTRY_PATH);
    expect(status.stale).toBeFalsy();
  });

  it("leaves stale undefined when entryPath is null (server not built)", async () => {
    await connectClient(claudeCode, roots, ENTRY_PATH);
    const status = await getClientStatus(claudeCode, roots, null);
    expect(status.stale).toBeUndefined();
  });

  it("flags a leftover --vault argument in the TOML client (codex) as stale", async () => {
    const filePath = codex.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `[mcp_servers.astro]\ncommand = "node"\nargs = ["${ENTRY_PATH}", "--vault", "/old/vault"]\n`, "utf8");
    const status = await getClientStatus(codex, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
    expect(status.stale).toBe(true);
  });

  it("reads falsy for the current TOML shape written by connectClient", async () => {
    await connectClient(codex, roots, ENTRY_PATH);
    const status = await getClientStatus(codex, roots, ENTRY_PATH);
    expect(status.stale).toBeFalsy();
  });
});

describe("multi-location clients (claude-desktop)", () => {
  const claudeDesktop = VERIFIED_CLIENTS.find((c) => c.id === "claude-desktop")!;

  it("writes to whichever install flavour's config actually exists", async () => {
    // Claude Desktop ships as both a plain Windows installer and a Store/MSIX package, and the MSIX
    // build reads only from its own redirected container. Writing the plain %APPDATA% path on a
    // machine running the Store build leaves the app seeing no MCP server at all.
    const [msixPath, classicPath] = claudeDesktop.configPaths(roots);
    await mkdir(path.dirname(classicPath), { recursive: true });
    await writeFile(classicPath, JSON.stringify({ preferences: { theme: "dark" } }), "utf8");

    await connectClient(claudeDesktop, roots, ENTRY_PATH);
    expect(existsSync(msixPath)).toBe(false);

    const written = JSON.parse(await readFile(classicPath, "utf8"));
    expect(written.mcpServers.astro).toEqual({ command: "node", args: [ENTRY_PATH] });
    // Everything the app already stored in that file must survive the merge.
    expect(written.preferences).toEqual({ theme: "dark" });
    expect((await getClientStatus(claudeDesktop, roots, ENTRY_PATH)).configPath).toBe(classicPath);
  });

  it("prefers the packaged container over the plain path when both exist", async () => {
    const [msixPath, classicPath] = claudeDesktop.configPaths(roots);
    for (const p of [msixPath, classicPath]) {
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, "{}", "utf8");
    }

    await connectClient(claudeDesktop, roots, ENTRY_PATH);
    expect(JSON.parse(await readFile(msixPath, "utf8")).mcpServers.astro).toBeDefined();
    expect(JSON.parse(await readFile(classicPath, "utf8")).mcpServers).toBeUndefined();
  });

  it("detects the Store package, which registers no uninstall key and no Start Menu shortcut", async () => {
    expect((await getClientStatus(claudeDesktop, roots, ENTRY_PATH)).detected).toBe(false);
    await mkdir(claudeDesktop.installedPaths(roots)[0], { recursive: true });
    expect((await getClientStatus(claudeDesktop, roots, ENTRY_PATH)).detected).toBe(true);
  });
});

describe("install detection", () => {
  const cursor = VERIFIED_CLIENTS.find((c) => c.id === "cursor")!;

  // The report this exists for: `~/.cursor/mcp.json` present, Cursor itself long uninstalled.
  // A config file is not an installation, and counting it would report an app that is not there.
  it("does not count a leftover config folder as an installation", async () => {
    await mkdir(path.dirname(cursor.configPaths(roots)[0]), { recursive: true });
    await writeFile(cursor.configPaths(roots)[0], "{}", "utf8");

    const status = await getClientStatus(cursor, roots, ENTRY_PATH);
    expect(status.detected).toBe(false);
    // ...and the row is still actionable: the config path is reported either way.
    expect(status.configPath).toBe(cursor.configPaths(roots)[0]);
  });

  it("counts the executable, wherever the installer put it", async () => {
    const exe = cursor.installedPaths(roots)[0];
    await mkdir(path.dirname(exe), { recursive: true });
    await writeFile(exe, "", "utf8");
    expect((await getClientStatus(cursor, roots, ENTRY_PATH)).detected).toBe(true);
  });

  // Files can be anywhere; the uninstall registry is where a conventional installer always
  // records itself. This is the case the old folder-only probe could not see at all.
  it("counts an uninstall-registry entry when no known path exists", async () => {
    const probes = { uninstallNames: ["cursor (user)"], startMenuShortcuts: [] };
    expect((await getClientStatus(cursor, roots, ENTRY_PATH, probes)).detected).toBe(true);
  });

  it("counts a Start Menu shortcut when no known path exists", async () => {
    const probes = { uninstallNames: [], startMenuShortcuts: ["cursor"] };
    expect((await getClientStatus(cursor, roots, ENTRY_PATH, probes)).detected).toBe(true);
  });

  it("stays undetected when every probe comes back empty", async () => {
    const probes = { uninstallNames: ["visual studio code", "obsidian"], startMenuShortcuts: ["notepad"] };
    expect((await getClientStatus(cursor, roots, ENTRY_PATH, probes)).detected).toBe(false);
  });
});

describe("YAML splice (goose)", () => {
  it("connectClient writes the astro block without disturbing the other extensions or trailing keys", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, GOOSE_FIXTURE, "utf8");

    const result = await connectClient(goose, roots, ENTRY_PATH);
    expect(result).toEqual({ ok: true });

    const written = await readFile(filePath, "utf8");
    expect(written).toContain("  computercontroller:\n    enabled: false");
    expect(written).toContain("  developer:\n    enabled: true");
    expect(written).toContain(`active_provider: local\nproviders:\n  local:\n    enabled: true\n    model: unsloth/gemma-4-E4B-it-GGUF:Q4_K_M\n    configured: true\nGOOSE_TELEMETRY_ENABLED: false`);
    expect(written).toContain(`  astro:\n    name: astro\n    cmd: node\n    args:\n      - "${ENTRY_PATH}"\n    enabled: true\n    type: stdio\n    timeout: 300`);

    const status = await getClientStatus(goose, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
  });

  it("is idempotent (connect twice == connect once)", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, GOOSE_FIXTURE, "utf8");

    await connectClient(goose, roots, ENTRY_PATH);
    const once = await readFile(filePath, "utf8");
    await connectClient(goose, roots, ENTRY_PATH);
    const twice = await readFile(filePath, "utf8");

    expect(twice).toBe(once);
  });

  it("connects when the file has no extensions key at all", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "active_provider: local\n", "utf8");

    const result = await connectClient(goose, roots, ENTRY_PATH);
    expect(result).toEqual({ ok: true });

    const written = await readFile(filePath, "utf8");
    expect(written).toContain("active_provider: local");
    expect(written).toContain(`extensions:\n  astro:\n    name: astro\n    cmd: node\n    args:\n      - "${ENTRY_PATH}"\n    enabled: true\n    type: stdio\n    timeout: 300`);

    const status = await getClientStatus(goose, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
  });

  it("disconnectClient removes only the astro block, leaving the rest byte-identical to the pre-connect file", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, GOOSE_FIXTURE, "utf8");

    await connectClient(goose, roots, ENTRY_PATH);
    const result = await disconnectClient(goose, roots);
    expect(result).toEqual({ ok: true });

    const written = await readFile(filePath, "utf8");
    expect(written).toBe(GOOSE_FIXTURE);

    const status = await getClientStatus(goose, roots, ENTRY_PATH);
    expect(status.state).toBe("not-configured");
  });

  it("getClientStatus reports not-configured before connect and configured after", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, GOOSE_FIXTURE, "utf8");

    expect((await getClientStatus(goose, roots, ENTRY_PATH)).state).toBe("not-configured");
    await connectClient(goose, roots, ENTRY_PATH);
    expect((await getClientStatus(goose, roots, ENTRY_PATH)).state).toBe("configured");
  });

  it("flags an astro entry whose args point at a different path as stale", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, GOOSE_FIXTURE, "utf8");
    await connectClient(goose, roots, "/old/dist/index.js");

    const status = await getClientStatus(goose, roots, ENTRY_PATH);
    expect(status.state).toBe("configured");
    expect(status.stale).toBe(true);
  });

  it("reads falsy for the current shape written by connectClient", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, GOOSE_FIXTURE, "utf8");
    await connectClient(goose, roots, ENTRY_PATH);

    const status = await getClientStatus(goose, roots, ENTRY_PATH);
    expect(status.stale).toBeFalsy();
  });

  it("round-trips a config that indents extensions' children by 4 spaces, not 2", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    const fourSpaceFixture = "extensions:\n    developer:\n        enabled: true\n        type: platform\nactive_provider: local\n";
    await writeFile(filePath, fourSpaceFixture, "utf8");

    await connectClient(goose, roots, ENTRY_PATH);
    const written = await readFile(filePath, "utf8");

    expect(written).toContain("    developer:\n        enabled: true\n        type: platform");
    expect(written).toContain(`    astro:\n      name: astro\n      cmd: node\n      args:\n        - "${ENTRY_PATH}"\n      enabled: true\n      type: stdio\n      timeout: 300`);
    expect(written).toContain("active_provider: local");

    await disconnectClient(goose, roots);
    expect(await readFile(filePath, "utf8")).toBe(fourSpaceFixture);
  });

  // The top-level block is matched at column 0, not by `trim()` — a nested key of the same name
  // would otherwise win (it comes first here) and every splice below it would land inside somebody
  // else's mapping, in a file Astro writes back to disk.
  it("ignores a nested key that happens to be named extensions", async () => {
    const filePath = goose.configPaths(roots)[0];
    await mkdir(path.dirname(filePath), { recursive: true });
    const nestedFixture = "providers:\n  local:\n    extensions:\n      foo: bar\nextensions:\n  developer:\n    enabled: true\n";
    await writeFile(filePath, nestedFixture, "utf8");

    await connectClient(goose, roots, ENTRY_PATH);
    const written = await readFile(filePath, "utf8");

    expect(written).toContain("providers:\n  local:\n    extensions:\n      foo: bar\n");
    expect(written).toContain(`extensions:\n  astro:\n    name: astro\n    cmd: node\n    args:\n      - "${ENTRY_PATH}"`);
    expect(written).toContain("  developer:\n    enabled: true");

    await disconnectClient(goose, roots);
    expect(await readFile(filePath, "utf8")).toBe(nestedFixture);
  });
});
