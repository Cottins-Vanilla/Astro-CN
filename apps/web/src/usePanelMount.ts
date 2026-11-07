import { useEffect, useState } from "react";

/**
 * Keeps a panel mounted through its exit animation. Components that render
 * `null` when closed can't animate *out* (the node is gone before any
 * transition runs), so this returns two flags:
 *
 * - `mounted` — keep the node in the DOM (stays true for `duration` ms after
 *   `open` flips to false, so the exit transition can play).
 * - `visible` — drive the open/closed CSS class; flips on the next frame after
 *   mount so the entrance transition runs from the closed state, and flips off
 *   immediately on close.
 *
 * CSS-only motion, no animation library — see index.css's `.panel-open` /
 * `.panel-closed`. `duration` must match the CSS transition duration.
 */
export function usePanelMount(open: boolean, duration = 240): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two rAFs: the first commits the just-mounted node in its closed state,
      // the second flips to open so the browser has a start frame to ease from.
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(t);
  }, [open, duration]);

  return { mounted, visible };
}
