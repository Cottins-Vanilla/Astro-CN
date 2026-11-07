/** Characters illegal in Windows filenames (also avoided on macOS/Linux for portability),
 * plus control characters. */
const ILLEGAL_CHARS_RE = /[/\\:*?"<>|\x00-\x1f]/g;

/** A title with only whitespace/illegal characters — falls back to the opaque id as filename. */
export function sanitizeTitle(title: string): string {
  return title
    .replace(ILLEGAL_CHARS_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "") // Windows rejects trailing dots/spaces
    .slice(0, 120);
}

/**
 * The filename (including extension) a note's title should mirror on disk, disambiguated against
 * `taken` (every other note's current filename, lowercased) so renames never silently overwrite a
 * different note. Falls back to `<id>.ext` when the title has no usable characters — a note
 * always has a valid file, even untitled.
 */
export function filenameForTitle(title: string, id: string, ext: string, taken: ReadonlySet<string>): string {
  const base = sanitizeTitle(title) || id;
  let candidate = `${base}${ext}`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  return candidate;
}
