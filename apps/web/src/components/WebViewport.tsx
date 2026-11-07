import { useEffect, useRef } from "react";

/**
 * Bounds-sync element for the active web tab's native `WebContentsView` — rendered only while
 * `App.tsx`'s active tab is a web tab (see docs/ARCH-TAB-WORKSPACE.md §3). A `WebContentsView` is a
 * native layer, not a DOM node, so this component's only footprint is `.workspace-viewport`, a
 * plain empty div whose on-screen rectangle (`getBoundingClientRect`) is continuously reported to
 * the main process via `browserAPI.setBounds` — that's what tells Electron where to draw the tab on
 * top of our window. Copied (mount-once effect, no deps) from the old BrowserPanel.tsx's
 * bounds-sync effect; re-runs on every mount since a tab switch mounts/unmounts this component.
 */
export function WebViewport() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const api = window.browserAPI;
    const el = ref.current;
    if (!api || !el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      void api.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, []);

  return <div ref={ref} className="workspace-viewport" />;
}
