import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeMcpServer } from "../mcpProbe.js";

// Short timeout for the tests that are meant to time out — the 8s default would make this suite
// slow without proving anything more.
const SHORT_TIMEOUT_MS = 300;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "solen-mcp-probe-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A few lines of plain Node that answer the two JSON-RPC ids a real probe sends and print the
 * vault banner on stderr, the same shape packages/mcp-server/src/index.ts produces. */
const FAKE_SERVER = `
const readline = require("node:readline");
console.error("solen-mcp running over stdio, vault: /fake/vault");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n");
  } else if (msg.id === 2) {
    const text = JSON.stringify([{ id: "n_1" }, { id: "n_2" }, { id: "n_3" }]);
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text }] } }) + "\\n",
    );
  }
});
`;

const EXITS_IMMEDIATELY = `console.error("No vault: Astro has no vault open, and no --vault was given."); process.exit(1);`;

const NEVER_ANSWERS = `setInterval(() => {}, 1000);`; // keeps the process alive, answers nothing

/** Same as FAKE_SERVER, but the banner is emitted one character at a time and only completed after
 * the notes have already gone out — the worst case for a stderr matcher that doesn't wait for the
 * end of the line. */
const SPLIT_BANNER_SERVER = `
const readline = require("node:readline");
const banner = "solen-mcp running over stdio, vault: /fake/split/vault";
let i = 0;
const drip = setInterval(() => {
  if (i < banner.length) process.stderr.write(banner[i++]);
  else { clearInterval(drip); process.stderr.write("\\n"); }
}, 5);
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n");
  } else if (msg.id === 2) {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "[]" }] } }) + "\\n",
    );
  }
});
`;

async function writeScript(source: string): Promise<string> {
  const scriptPath = path.join(dir, "server.js");
  await writeFile(scriptPath, source, "utf8");
  return scriptPath;
}

describe("probeMcpServer", () => {
  it("resolves ok:true with the parsed vault path and note count", async () => {
    const scriptPath = await writeScript(FAKE_SERVER);
    const result = await probeMcpServer(scriptPath);
    expect(result).toEqual({ ok: true, vaultPath: "/fake/vault", noteCount: 3 });
  });

  it("surfaces the server's own no-vault message when it exits before responding", async () => {
    const scriptPath = await writeScript(EXITS_IMMEDIATELY);
    const result = await probeMcpServer(scriptPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no vault/i);
  });

  it("waits for the whole banner line before reporting a vault path", async () => {
    // stderr arrives in arbitrary chunks. Matching a bare `vault: (.+)` reported the fragment that
    // had landed so far — a truncated path, presented as a successful test.
    const scriptPath = await writeScript(SPLIT_BANNER_SERVER);
    const result = await probeMcpServer(scriptPath);
    expect(result).toEqual({ ok: true, vaultPath: "/fake/split/vault", noteCount: 0 });
  });

  it("times out instead of hanging when the server never answers", async () => {
    const scriptPath = await writeScript(NEVER_ANSWERS);
    const result = await probeMcpServer(scriptPath, SHORT_TIMEOUT_MS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out/i);
  });
});
