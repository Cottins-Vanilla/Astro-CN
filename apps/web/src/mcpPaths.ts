/**
 * Collapses a home directory prefix to `~`, so a config path is short enough to read on one line
 * and a screenshot of Settings → Connections doesn't publish the user's account name.
 *
 * Matched by shape rather than against the real home directory, which the renderer never receives —
 * a path outside the home directory is left verbatim, which is the right answer anyway.
 */
export function tildeHome(p: string): string {
  return p.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, "~").replace(/^\/(?:home|Users)\/[^/]+/, "~");
}
