import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { fuzzyMatch, fuzzyScore } from "../fuzzy";

interface NotePickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen (or newly created) note title. */
  onPick: (title: string) => void;
}

/**
 * Fuzzy note picker used by both the editor's Ctrl+L / insert-link action
 * and the connections strip's "+ Connect" button — the one syntax-free path
 * everything funnels through per docs/DESIGN.md's linking section.
 */
export function NotePicker({ open, onClose, onPick }: NotePickerProps) {
  const noteList = useStore((s) => s.noteList);
  const createNote = useStore((s) => s.createNote);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim();
    return [...noteList]
      .filter((n) => fuzzyMatch(q, n.title || "未命名"))
      .sort((a, b) => fuzzyScore(q, a.title) - fuzzyScore(q, b.title))
      .slice(0, 30);
  }, [noteList, query]);

  const exactMatch = query.trim() && noteList.some((n) => n.title.toLowerCase() === query.trim().toLowerCase());
  const showCreate = query.trim().length > 0 && !exactMatch;
  const itemCount = matches.length + (showCreate ? 1 : 0);

  async function commitIndex(index: number) {
    if (showCreate && index === matches.length) {
      const title = query.trim();
      await createNote(title);
      onPick(title);
    } else if (matches[index]) {
      onPick(matches[index].title);
    }
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(itemCount - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void commitIndex(activeIndex);
    }
  }

  if (!open) return null;

  return (
    <div className="overlay-backdrop" onMouseDown={onClose}>
      <div className="palette-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="搜索要关联的笔记…"
          className="palette-input"
        />
        <ul className="palette-list">
          {matches.map((n, i) => (
            <li key={n.id}>
              <button
                className={`palette-item ${i === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => void commitIndex(i)}
              >
                {n.title || "未命名"}
              </button>
            </li>
          ))}
          {showCreate && (
            <li>
              <button
                className={`palette-item ${matches.length === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(matches.length)}
                onClick={() => void commitIndex(matches.length)}
              >
                新建“{query.trim()}”
              </button>
            </li>
          )}
          {matches.length === 0 && !showCreate && <li className="palette-empty">还没有笔记</li>}
        </ul>
      </div>
    </div>
  );
}
