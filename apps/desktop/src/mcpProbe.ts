import { spawn } from "node:child_process";

/**
 * Settings → Connections' "Test connection" button. Astro can't observe an AI client actually
 * reading the config file it wrote (see mcpConnections.ts) — but it can reproduce the only part of
 * "are we connected" that's checkable from here: spawn the exact `node <entryPath>` command written
 * into every client's config, speak MCP over stdio the way a real client would, and call list_notes.
 */
export type McpProbeResult = { ok: true; vaultPath: string; noteCount: number } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 8000;

const rpc = (msg: Record<string, unknown>) => JSON.stringify(msg) + "\n";

export async function probeMcpServer(entryPath: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<McpProbeResult> {
  return new Promise((resolvePromise) => {
    let settled = false;
    let stderrBuf = "";
    let stdoutTail = "";
    let noteCount: number | null = null;

    // No extra args — exactly the command written into every client's config file.
    const child = spawn("node", [entryPath], { stdio: ["pipe", "pipe", "pipe"] });

    const timer = setTimeout(() => {
      finish({ ok: false, error: `等待连接服务响应超过 ${timeoutMs / 1000} 秒。` });
    }, timeoutMs);

    function finish(result: McpProbeResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A resolved probe must never leave the child running — this is a click-triggered spawn, not
      // a long-lived connection, so leaking one node process per test would add up fast.
      try {
        child.kill();
      } catch {
        // already exited
      }
      resolvePromise(result);
    }

    // Success needs both halves — the list_notes result (stdout) and the vault banner (stderr) —
    // and they can arrive in either order, so re-check on every new piece of either.
    function tryFinishSuccess(): void {
      if (noteCount === null) return;
      // Require the line terminator: stderr arrives in arbitrary chunks, so a banner split
      // mid-path would otherwise match here and report a truncated vault path as a success.
      const vaultMatch = /vault: (.+)\r?\n/.exec(stderrBuf);
      if (!vaultMatch) return;
      finish({ ok: true, vaultPath: vaultMatch[1].trim(), noteCount });
    }

    child.on("error", (err) => {
      // ENOENT (no `node` on PATH) or similar — never an unhandled rejection.
      finish({ ok: false, error: `无法启动连接服务：${err.message}` });
    });

    // The server can exit between our two writes, and an EPIPE on this stream with no listener is
    // an uncaught exception — which in the Electron main process takes the whole app down. The
    // failure is already reported through `exit`/`error` above, so there is nothing to do here.
    child.stdin?.on("error", () => {});

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      tryFinishSuccess();
    });

    child.on("exit", (code) => {
      if (settled) return;
      // Exiting before either response is in means startup failed — most commonly no vault open
      // (see packages/mcp-server/src/index.ts), which prints its own readable line on stderr.
      const noVaultLine = /^No vault:.*$/m.exec(stderrBuf)?.[0];
      const detail = stderrBuf.trim();
      finish({
        ok: false,
        error: noVaultLine ?? `连接服务提前退出（代码 ${code}），尚未返回结果。${detail ? ` ${detail}` : ""}`,
      });
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutTail += chunk.toString("utf8");
      const lines = stdoutTail.split("\n");
      stdoutTail = lines.pop() ?? ""; // incomplete line — kept for the next chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: { id?: number; result?: { content?: { type: string; text: string }[] } };
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue; // not a JSON-RPC line
        }

        if (msg.id === 1) {
          // Handshake done — complete it, then ask for the notes.
          child.stdin?.write(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));
          child.stdin?.write(
            rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_notes", arguments: {} } }),
          );
        } else if (msg.id === 2) {
          try {
            const notes = JSON.parse(msg.result?.content?.[0]?.text ?? "");
            noteCount = Array.isArray(notes) ? notes.length : 0;
            tryFinishSuccess();
          } catch (err) {
            finish({ ok: false, error: `无法读取连接服务返回的内容：${(err as Error).message}` });
          }
        }
      }
    });

    child.stdin?.write(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "astro-probe", version: "1" } },
      }),
    );
  });
}
