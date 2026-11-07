import type { NoteContent, SolenPlugin } from "@solen/plugin-api";

/**
 * Daily Note — finds or creates today's note and surfaces a panel of recent
 * daily notes. Same constraints as wordcount.ts: only `api` + DOM, no store
 * or React import.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local YYYY-MM-DD (not `toISOString`, which is UTC and can be off-by-one near midnight). */
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function countWords(body: string): number {
  const trimmed = body.trim();
  return Array.from(trimmed.replace(/\s/g, "")).length;
}

function renderEntries(
  el: HTMLElement,
  entries: Array<{ id: string; title: string; words: number }>,
  onOpen: (id: string) => void,
): void {
  el.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "daily-note-empty";
    empty.textContent = "还没有每日笔记。";
    el.append(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "daily-note-list";
  for (const entry of entries) {
    const row = document.createElement("li");
    row.className = "daily-note-row";
    row.onclick = () => onOpen(entry.id);
    const dateEl = document.createElement("span");
    dateEl.className = "daily-note-date";
    dateEl.textContent = entry.title;
    const wordsEl = document.createElement("span");
    wordsEl.className = "daily-note-words";
    wordsEl.textContent = `${entry.words} 个字符`;
    row.append(dateEl, wordsEl);
    list.append(row);
  }
  el.append(list);
}

const dailyNotePlugin: SolenPlugin = {
  id: "daily-note",
  name: "每日笔记",
  version: "0.1.0",

  onload(api) {
    api.commands.register({
      id: "daily-note.open",
      name: "每日笔记：打开今天的笔记",
      keywords: ["daily", "today", "journal"],
      run: async () => {
        const today = todayKey();
        const existing = (await api.notes.list()).find((n) => n.title === today);
        const id = existing ? existing.id : (await api.notes.create(today, `# ${today}\n`)).id;
        await api.notes.open(id);
      },
    });

    api.ui.registerPanel({
      id: "daily-note",
      title: "每日笔记",
      render(el) {
        // See wordcount.ts — render into an owned child, never overwrite el.className.
        const container = document.createElement("div");
        container.className = "daily-note-panel";
        el.append(container);
        let cancelled = false;

        async function refresh() {
          try {
            const summaries = await api.notes.list();
            const daily = summaries
              .filter((n) => DATE_RE.test(n.title))
              .sort((a, b) => b.title.localeCompare(a.title))
              .slice(0, 14);
            const notes: NoteContent[] = await Promise.all(daily.map((n) => api.notes.read(n.id)));
            if (cancelled) return;
            renderEntries(
              container,
              notes.map((n) => ({ id: n.id, title: n.title, words: countWords(n.body) })),
              (id) => void api.notes.open(id),
            );
          } catch (err) {
            if (cancelled) return;
            container.textContent = `无法打开每日笔记：${err instanceof Error ? err.message : String(err)}`;
          }
        }

        void refresh();

        const onChange = () => void refresh();
        api.events.on("note:created", onChange);
        api.events.on("note:updated", onChange);
        api.events.on("note:deleted", onChange);

        return () => {
          cancelled = true;
          api.events.off("note:created", onChange);
          api.events.off("note:updated", onChange);
          api.events.off("note:deleted", onChange);
        };
      },
    });
  },
};

export default dailyNotePlugin;
