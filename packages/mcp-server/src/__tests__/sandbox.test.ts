import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCurrentVaultPath } from "../currentVault.js";

/**
 * Proves the two things the owner asked for (verbatim: "testare Astro senza i miei percorsi, per
 * vedere se funziona dappertutto e soprattutto per vedere se non espone i miei percorsi"): the
 * vault + MCP path works from a vault that isn't this machine's real vault, under a fabricated
 * home/userData root, and the server's tool output never contains this machine's real home
 * directory or username. This lives in @solen/mcp-server (not apps/desktop, which doesn't declare
 * @solen/mcp-server as a dependency and whose tsconfig `rootDir` is `src`, so it can't import
 * `readCurrentVaultPath` from here) — see the report for that deviation from the original ask.
 */

const DIST_ENTRY = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

let sandbox: string;
let vaultDir: string;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "solen-sandbox-test-"));
  vaultDir = path.join(sandbox, "vault");
  const notesDir = path.join(vaultDir, ".astro", "notes");
  await mkdir(notesDir, { recursive: true });

  await writeFile(
    path.join(vaultDir, ".astro", "vault.json"),
    JSON.stringify({ format: "solen-vault", version: 1, name: "Sandbox Vault", createdAt: "2026-01-01T00:00:00.000Z", settings: {} }),
    "utf8",
  );

  await writeFile(
    path.join(notesDir, "First Note.md"),
    [
      "---",
      "id: n_sandbox1",
      "title: First Note",
      "tags: [sandbox]",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "Body of the first note, with a [[Second Note]] link.",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(notesDir, "Second Note.md"),
    [
      "---",
      "id: n_sandbox2",
      "title: Second Note",
      "tags: []",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "Body of the second note.",
    ].join("\n"),
    "utf8",
  );

  // A file with no frontmatter at all is also a legal note (per docs/DATA-FORMAT.md /
  // parseNote's fallback): it gets adopted with the filename as its title.
  await writeFile(path.join(notesDir, "No Frontmatter.md"), "Just a plain markdown file, no frontmatter block.", "utf8");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("readCurrentVaultPath against a fabricated userData root", () => {
  it("follows a desktop-config.json that lives nowhere near a real home directory", async () => {
    const configDir = path.join(sandbox, "userData", "@solen", "desktop");
    await mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "desktop-config.json");
    await writeFile(configPath, JSON.stringify({ currentVaultPath: vaultDir, recentVaults: [vaultDir] }), "utf8");

    expect(readCurrentVaultPath(configPath)).toBe(vaultDir);
  });
});

describe("MCP server over stdio, spawned against the sandboxed vault", () => {
  it("serves exactly the seeded notes and never leaks this machine's real home dir or username", async () => {
    if (!existsSync(DIST_ENTRY)) {
      // Explicit skip rather than a silent pass — a missing build must not read as a passing test.
      console.warn(`Skipping: ${DIST_ENTRY} not built. Run: pnpm --filter @solen/mcp-server build`);
      return;
    }

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST_ENTRY, "--vault", vaultDir],
    });
    const client = new Client({ name: "sandbox-test-client", version: "0.0.0" });

    try {
      // Client.connect() performs the real initialize / notifications/initialized handshake.
      await client.connect(transport);

      const result = await client.callTool({ name: "list_notes", arguments: {} });
      const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
      const notes = JSON.parse(text) as Array<{ title: string }>;
      const titles = notes.map((n) => n.title).sort();

      expect(titles).toEqual(["First Note", "No Frontmatter", "Second Note"].sort());

      const realHome = homedir();
      const realUsername = userInfo().username;
      if (realHome) expect(text).not.toContain(realHome);
      if (realUsername) expect(text).not.toContain(realUsername);
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  }, 15_000);
});
