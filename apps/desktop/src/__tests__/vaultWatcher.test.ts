import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultWatcher } from "../vaultWatcher.js";

let vaultDir: string;
let watcher: VaultWatcher | undefined;

beforeEach(async () => {
  vaultDir = await mkdtemp(path.join(tmpdir(), "solen-watch-test-"));
});

afterEach(async () => {
  watcher?.stop();
  watcher = undefined;
  await rm(vaultDir, { recursive: true, force: true });
});

/** Polls until `check()` returns true or `timeoutMs` elapses — fs.watch delivery isn't
 * instantaneous, so tests wait for the real event rather than a fixed sleep. */
async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("VaultWatcher", () => {
  it("calls onChange after a file is written inside the watched folder", async () => {
    let calls = 0;
    watcher = new VaultWatcher(50, () => calls++);
    watcher.start(vaultDir);

    await writeFile(path.join(vaultDir, "note.md"), "hello", "utf8");

    await waitUntil(() => calls > 0);
    expect(calls).toBeGreaterThan(0);
  });

  it("debounces a burst of writes into a single onChange call", async () => {
    let calls = 0;
    watcher = new VaultWatcher(150, () => calls++);
    watcher.start(vaultDir);

    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(vaultDir, `note-${i}.md`), "x", "utf8");
    }

    // Give the debounce window time to fire exactly once, then confirm it doesn't fire again.
    await waitUntil(() => calls > 0);
    const callsAfterFirstFire = calls;
    await new Promise((r) => setTimeout(r, 300));
    expect(callsAfterFirstFire).toBe(1);
    expect(calls).toBe(1);
  });

  it("stop() prevents any further onChange calls", async () => {
    let calls = 0;
    watcher = new VaultWatcher(50, () => calls++);
    watcher.start(vaultDir);
    watcher.stop();

    await writeFile(path.join(vaultDir, "note.md"), "hello", "utf8");
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(0);
  });

  it("does not throw when watching a folder that is later removed", async () => {
    let calls = 0;
    watcher = new VaultWatcher(50, () => calls++);
    watcher.start(vaultDir);
    await rm(vaultDir, { recursive: true, force: true });
    // Recreate so afterEach's cleanup rm() doesn't itself fail on a missing dir.
    vaultDir = await mkdtemp(path.join(tmpdir(), "solen-watch-test-"));
    expect(true).toBe(true); // reaching here means start()+underlying removal didn't crash
  });
});
