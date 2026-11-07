import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalEvent } from "../browserTypes";
import { useStore } from "../store";
import { usePanelMount } from "../usePanelMount";

/** Reads the app's live CSS custom properties into an xterm theme — same source App.tsx's
 * title-bar-overlay effect reads `--color-bg`/`--color-accent` from, so the terminal never looks
 * pasted in against whichever theme (or accent override, docs/ARCH-APPEARANCE.md §2) is active. */
function readXtermTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue("--color-bg").trim(),
    foreground: styles.getPropertyValue("--color-text").trim(),
    cursor: styles.getPropertyValue("--color-accent").trim(),
  };
}

/**
 * Floating terminal panel (see App.tsx's .floating-dock), following AIPanel.tsx's chrome and
 * mount/animation pattern. Desktop-only — only ever opened via the ribbon button that itself only
 * renders when `window.terminalAPI` exists (browser build has no shell to spawn).
 *
 * A fresh shell is spawned every time the panel mounts (i.e. every open — `usePanelMount` keeps
 * it mounted through the close animation, then unmounts) and killed on unmount. ponytail: no
 * persistence of output/shell across close/reopen — one terminal at a time is cheap to respawn,
 * see TerminalManager (apps/desktop/src/terminal.ts).
 */
export function TerminalPanel() {
  const open = useStore((s) => s.terminalOpen);
  const { mounted, visible } = usePanelMount(open);
  const toggle = useStore((s) => s.toggleTerminal);
  const theme = useStore((s) => s.theme);
  const accentColor = useStore((s) => s.accentColor);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, toggle]);

  useEffect(() => {
    const api = window.terminalAPI;
    const host = hostRef.current;
    if (!mounted || !api || !host) return;

    const term = new Terminal({ fontSize: 13, theme: readXtermTheme() });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    // Opening the panel should leave you able to type straight away — without this the keyboard
    // focus stays wherever it was and the terminal silently swallows nothing at all.
    term.focus();
    termRef.current = term;

    // Guards the create() promise racing an early unmount (e.g. React 18 StrictMode's
    // mount-cleanup-mount in dev, see store.ts's initPromise comment for the same race elsewhere)
    // — if the panel is gone before the shell id comes back, kill it immediately instead of
    // leaking an orphaned process this effect no longer has a handle on.
    let disposed = false;
    let id: string | null = null;
    // Keystrokes typed before create() resolves are buffered here and flushed once the pty exists,
    // instead of being silently dropped.
    let pending = "";
    // A pty starts talking the moment it spawns — the shell banner and first prompt are emitted in
    // main before the `terminal:create` reply has crossed back over IPC and set `id`. Events that
    // arrive in that window can't be matched against an id yet, so they're held here and replayed
    // once it lands; without this the terminal opens on a blank screen with no prompt.
    const earlyEvents: TerminalEvent[] = [];
    void api.create(term.cols, term.rows).then((newId) => {
      if (disposed) {
        void api.kill(newId);
        return;
      }
      id = newId;
      for (const event of earlyEvents.splice(0)) handleEvent(event);
      if (pending) {
        void api.write(id, pending);
        pending = "";
      }
    });

    // Every keystroke goes straight to the pty — it's a real TTY now (see apps/desktop/src/
    // terminal.ts), so the shell itself echoes input, handles Backspace/cursor keys, and raw-mode
    // TUIs (vim, top, claude, codex) get their input directly instead of going through a local
    // line editor.
    const dataDisposable = term.onData((data) => {
      if (!id) {
        pending += data;
        return;
      }
      void api.write(id, data);
    });
    function handleEvent(event: TerminalEvent) {
      if (event.type === "data") term.write(event.chunk);
      else term.write(`\r\n[程序已退出，退出代码：${event.code}]\r\n`);
    }
    const unsubscribe = api.onEvent((event) => {
      if (id === null) earlyEvents.push(event);
      else if (event.id === id) handleEvent(event);
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (id) void api.resize(id, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      dataDisposable.dispose();
      unsubscribe();
      term.dispose();
      termRef.current = null;
      if (id) void api.kill(id);
    };
  }, [mounted]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = readXtermTheme();
  }, [theme, accentColor]);

  if (!mounted) return null;

  return (
    <div className={`floating-panel terminal-panel ${visible ? "panel-open" : "panel-closed"}`}>
      <div className="dock-panel-header">
        <span>命令终端</span>
        <button
          onClick={toggle}
          title="关闭（Esc）"
          className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-base leading-none px-1"
        >
          ×
        </button>
      </div>
      <div ref={hostRef} className="terminal-host" />
    </div>
  );
}
