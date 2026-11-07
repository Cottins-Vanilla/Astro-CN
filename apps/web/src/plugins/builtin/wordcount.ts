import type { NoteContent, SolenPlugin } from "@solen/plugin-api";

/**
 * Reference plugin, shipped with the app as proof the SolenAPI surface
 * works end-to-end (docs/PLUGINS.md walks through this file). It only
 * touches `api` and browser DOM/event primitives — no store or React
 * import — exactly what a third-party plugin would see.
 */

interface Stats {
  notes: number;
  words: number;
  links: number;
  tags: number;
}

function computeStats(notes: NoteContent[]): Stats {
  const tagSet = new Set<string>();
  let words = 0;
  let links = 0;
  for (const note of notes) {
    const trimmed = note.body.trim();
    words += Array.from(trimmed.replace(/\s/g, "")).length;
    links += (note.body.match(/\[\[[^\]]+\]\]/g) ?? []).length;
    for (const tag of note.tags) tagSet.add(tag);
  }
  return { notes: notes.length, words, links, tags: tagSet.size };
}

function renderStats(el: HTMLElement, stats: Stats): void {
  el.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "wordcount-grid";
  const entries: [string, number][] = [
    ["笔记数", stats.notes],
    ["字符数", stats.words],
    ["相关笔记", stats.links],
    ["标签数", stats.tags],
  ];
  for (const [label, value] of entries) {
    const cell = document.createElement("div");
    cell.className = "wordcount-stat";
    const valueEl = document.createElement("span");
    valueEl.className = "wordcount-value";
    valueEl.textContent = String(value);
    const labelEl = document.createElement("span");
    labelEl.className = "wordcount-label";
    labelEl.textContent = label;
    cell.append(valueEl, labelEl);
    grid.append(cell);
  }
  el.append(grid);
}

const wordcountPlugin: SolenPlugin = {
  id: "wordcount",
  name: "字数统计",
  version: "0.1.0",

  onload(api) {
    api.commands.register({
      id: "wordcount.show",
      name: "字数统计：查看知识库概况",
      keywords: ["stats", "words", "count", "tags", "links"],
      run: () => {
        window.dispatchEvent(new CustomEvent("solen:plugin-panel-open", { detail: { id: "wordcount" } }));
      },
    });

    api.ui.registerPanel({
      id: "wordcount",
      title: "字数统计",
      render(el) {
        // Plugin panels share their host node with PluginDrawer.tsx's own layout classes
        // (flex-1/min-h-0/overflow-auto) — overwriting el.className directly used to clobber
        // those permanently. Render into an owned child instead.
        const container = document.createElement("div");
        container.className = "wordcount-panel";
        el.append(container);
        let cancelled = false;

        async function refresh() {
          try {
            const summaries = await api.notes.list();
            const notes = await Promise.all(summaries.map((n) => api.notes.read(n.id)));
            if (cancelled) return;
            renderStats(container, computeStats(notes));
          } catch (err) {
            if (cancelled) return;
            container.textContent = `字数统计失败：${err instanceof Error ? err.message : String(err)}`;
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

export default wordcountPlugin;
