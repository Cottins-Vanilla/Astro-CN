import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string; busy: boolean; error: string; danger: boolean; confirmLabel: string; children: ReactNode;
  onCancel: () => void; onSubmit: (event: FormEvent) => void;
}
export function SidebarDialog({ title, busy, error, danger, confirmLabel, children, onCancel, onSubmit }: Props) {
  const panel = useRef<HTMLFormElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    (panel.current?.querySelector<HTMLElement>("input:not([type=checkbox]), select, button") ?? panel.current)?.focus();
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  }, []);
  return createPortal(<div className="sidebar-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <form ref={panel} className="sidebar-dialog" role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} tabIndex={-1}
      onSubmit={onSubmit} onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); if (!busy) onCancel(); }
        if (e.key === "Tab") {
          const items = panel.current?.querySelectorAll<HTMLElement>("input:not(:disabled),select:not(:disabled),button:not(:disabled)");
          if (!items?.length) { e.preventDefault(); return; }
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}>
      <h2>{title}</h2>
      <div className="sidebar-dialog-content">{children}</div>
      {error && <p role="alert" className="sidebar-error">{error}</p>}
      <div className="sidebar-dialog-actions">
        <button type="button" onClick={onCancel} disabled={busy}>取消</button>
        <button type="submit" className={danger ? "danger" : "primary"} disabled={busy}>{busy ? "正在处理…" : confirmLabel}</button>
      </div>
    </form>
  </div>, document.body);
}

