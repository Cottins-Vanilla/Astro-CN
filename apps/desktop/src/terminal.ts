import pty from "@lydell/node-pty";
import os from "node:os";

export type TerminalEvent =
  | { type: "data"; id: string; chunk: string }
  | { type: "exit"; id: string; code: number | null };

let nextId = 1;

/**
 * Manages the integrated terminal's shell process(es) as real pseudoterminals via `@lydell/node-pty`
 * (a prebuilt binary, no native rebuild needed under Electron), in the shape of `BrowserTabManager`
 * (browserTabs.ts): a class owning the resources, an `emit` callback for pushes to the renderer.
 * A PTY gives the shell a real TTY — raw mode, resize signals, and echo all work — so full TUIs
 * (vim, top, `claude`, `codex`) render correctly and Ctrl+C signals the running process instead of
 * only editing a locally-buffered line.
 *
 * Security: `create` takes no command or argv from the renderer — only main.ts decides what to
 * spawn (the platform shell) and where (the current vault path). Keep it that way.
 */
export class TerminalManager {
  private readonly ptys = new Map<string, pty.IPty>();

  constructor(private readonly emit: (event: TerminalEvent) => void) {}

  create(cwd: string | null, cols = 80, rows = 24): string {
    const id = String(nextId++);
    const shellCmd = process.platform === "win32" ? (process.env.ComSpec ?? "powershell.exe") : (process.env.SHELL ?? "/bin/bash");
    // ponytail: no `useConpty` option here — @lydell/node-pty 1.1.0 is ConPTY-only on Windows (no
    // winpty fallback to toggle), so the option this repo's older instructions named doesn't exist
    // on this package version's type or runtime.
    const p = pty.spawn(shellCmd, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: cwd ?? os.homedir(),
      env: process.env,
    });
    this.ptys.set(id, p);

    p.onData((chunk) => this.emit({ type: "data", id, chunk }));
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id);
      this.emit({ type: "exit", id, code: exitCode });
    });

    return id;
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    // Same Windows failure mode as kill(): resizing a pty whose shell already exited throws, and
    // the renderer resizes on every layout change — including the one caused by the panel closing.
    try {
      this.ptys.get(id)?.resize(cols, rows);
    } catch {
      // ignore
    }
  }

  kill(id: string): void {
    // Killing an already-exited pty (e.g. the shell exited on its own just before the panel
    // unmounts) throws on Windows — this is just cleanup, not a signal worth surfacing.
    try {
      this.ptys.get(id)?.kill();
    } catch {
      // ignore
    }
    this.ptys.delete(id);
  }

  /** Kills every live shell — called on app quit (main.ts's `window-all-closed`) so a spawned
   * shell never outlives the window that owns it. */
  killAll(): void {
    for (const p of this.ptys.values()) {
      try {
        p.kill();
      } catch {
        // ignore — see kill()'s comment
      }
    }
    this.ptys.clear();
  }
}
