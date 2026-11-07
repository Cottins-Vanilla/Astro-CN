import { useEffect, useState } from "react";

/**
 * The app's own minimize / maximize / close buttons, at the right end of the tab strip.
 *
 * Electron can draw these natively (`titleBarOverlay`), and Astro used to let it. The problem is
 * that native chrome is painted on top of the web contents and cannot participate in anything the
 * app renders: `.overlay-backdrop` dims the entire window behind a modal and the native strip
 * stayed at full brightness — a white rectangle in the corner of a dimmed light theme — and
 * Settings → Interface zoom scales the DOM while the overlay stays a fixed 32px. Pushing
 * corrected colors over IPC only ever patched one instance of that at a time. These are ordinary
 * buttons, so they dim, scale, hover and follow the theme with everything else.
 *
 * Windows/Linux only: under `titleBarStyle: "hidden"` macOS still shows its own traffic lights, and
 * a second set beside them would be one set too many.
 */
export function WindowControls() {
  const [api] = useState(() => (typeof window !== "undefined" ? window.windowAPI : undefined));
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    void api.isMaximized().then(setMaximized);
    return api.onMaximizedChange(setMaximized);
  }, [api]);

  if (!api || api.platform === "darwin") return null;

  return (
    <div className="window-controls">
      <button className="window-control" onClick={() => void api.minimize()} aria-label="最小化" title="最小化">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        className="window-control"
        onClick={() => void api.toggleMaximize()}
        aria-label={maximized ? "还原窗口" : "最大化"}
        title={maximized ? "还原窗口" : "最大化"}
      >
        {/* Restore is the OS's own two-overlapping-rectangles glyph, so the button reads the same
            way as every other window on the desktop. */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          {maximized ? (
            <>
              <path d="M2.5 2.5V0.5h7v7h-2" />
              <rect x="0.5" y="2.5" width="7" height="7" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" />
          )}
        </svg>
      </button>
      <button
        className="window-control close"
        onClick={() => void api.close()}
        aria-label="关闭"
        title="关闭"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
