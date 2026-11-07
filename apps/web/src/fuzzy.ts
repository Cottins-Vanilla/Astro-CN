/**
 * Minimal fuzzy matching for the command palette and note picker — a
 * subsequence match (every query character appears in order) is enough for
 * short lists like note titles and commands, so no dependency is needed.
 */

/** True when every character of `query` appears in `text`, in order (case-insensitive). */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Lower is better. Contiguous substring matches rank by position; looser
 * subsequence-only matches rank after all of those. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  return idx !== -1 ? idx : 1000 + t.length;
}
