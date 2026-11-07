#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { readCurrentVaultPath } from "./currentVault.js";

function parseVaultArg(argv: string[]): string | undefined {
  const flagIndex = argv.indexOf("--vault");
  if (flagIndex !== -1) return argv[flagIndex + 1];
  const eq = argv.find((a) => a.startsWith("--vault="));
  return eq?.slice("--vault=".length);
}

async function main() {
  // `--vault` is an override, not a requirement: with no flag the server follows whatever vault
  // Astro currently has open, re-read on every tool call (see currentVault.ts). That keeps the
  // vault path out of every MCP client's config file, where it would otherwise go stale the first
  // time the user switched vaults in the app.
  const explicitArg = parseVaultArg(process.argv.slice(2));

  if (explicitArg && !existsSync(resolve(explicitArg))) {
    console.error(`Vault directory not found: ${resolve(explicitArg)}`);
    process.exit(1);
  }

  if (!explicitArg && !readCurrentVaultPath()) {
    console.error("No vault: Astro has no vault open, and no --vault was given.");
    console.error("Open a vault in Astro, or pass one explicitly:");
    console.error("  solen-mcp --vault <path-to-vault-directory>");
    process.exit(1);
  }

  const resolveVaultDir = () => {
    const dir = explicitArg ?? readCurrentVaultPath();
    if (!dir) throw new Error("No vault open in Astro. Open one, or restart this server with --vault.");
    return resolve(dir);
  };

  const server = createServer(resolveVaultDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`solen-mcp running over stdio, vault: ${resolveVaultDir()}`);
}

main().catch((err) => {
  console.error("solen-mcp failed to start:", err);
  process.exit(1);
});
