import type { NoteContent, SolenPlugin } from "@solen/plugin-api";

/**
 * Vault Doctor — audits link/title health from the public API only. Same
 * constraints as wordcount.ts: only `api` + DOM, no store/React/@solen/core
 * import (plugins are sandboxed to SolenAPI even though this app ships it).
 */

// Deliberately duplicated from packages/core/src/wikilinks.ts's WIKILINK_RE. Plugins can't
// import @solen/core, but this audit must never disagree with the app's own link resolution
// (packages/core/src/graph.ts's buildLinkIndex) about what counts as a link — so the regex and
// the case-insensitive title match below are copied, not reinvented. Keep these in sync by hand
// if wikilinks.ts ever changes.
//
// Note this also means `[[Note#Heading]]` is NOT special-cased here, same as upstream: the
// whole "Note#Heading" string is the target, so it shows as broken exactly when it would also
// fail to resolve in the graph view.
const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export interface BrokenLink {
  fromTitle: string;
  target: string;
}

export interface DuplicateGroup {
  titles: string[];
}

export interface VaultHealthReport {
  brokenLinks: BrokenLink[];
  orphanTitles: string[];
  duplicateGroups: DuplicateGroup[];
}

/** Pure so it's unit-testable without a live vault — see __tests__/vaultDoctor.test.ts. */
export function auditVault(notes: Array<Pick<NoteContent, "id" | "title" | "body">>): VaultHealthReport {
  // Last note with a given lowercase title wins a link-resolution lookup — mirrors graph.ts's
  // `byLowerTitle` map exactly, so a duplicate title's shadowed note reads as an orphan here too
  // (its own section below calls out the duplicate separately).
  const byLowerTitle = new Map<string, Pick<NoteContent, "id" | "title" | "body">>();
  for (const n of notes) byLowerTitle.set(n.title.toLowerCase(), n);

  const inboundIds = new Set<string>();
  const brokenLinks: BrokenLink[] = [];
  for (const note of notes) {
    for (const match of note.body.matchAll(WIKILINK_RE)) {
      const target = match[1].trim();
      const resolved = byLowerTitle.get(target.toLowerCase());
      if (resolved) inboundIds.add(resolved.id);
      else brokenLinks.push({ fromTitle: note.title, target });
    }
  }

  const orphanTitles = notes.filter((n) => !inboundIds.has(n.id)).map((n) => n.title);

  const titlesByLower = new Map<string, string[]>();
  for (const n of notes) {
    const key = n.title.toLowerCase();
    const group = titlesByLower.get(key);
    if (group) group.push(n.title);
    else titlesByLower.set(key, [n.title]);
  }
  const duplicateGroups: DuplicateGroup[] = [...titlesByLower.values()]
    .filter((titles) => titles.length > 1)
    .map((titles) => ({ titles }));

  return { brokenLinks, orphanTitles, duplicateGroups };
}

/** `openId` set means the title resolved to a real note — render it clickable. */
function renderSection(label: string, items: Array<{ text: string; openId?: string }>, onOpen: (id: string) => void): HTMLElement {
  const section = document.createElement("div");
  section.className = "vault-doctor-section";
  const heading = document.createElement("h3");
  heading.className = "vault-doctor-heading";
  heading.textContent = `${label} (${items.length})`;
  section.append(heading);
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "vault-doctor-empty";
    empty.textContent = "无";
    section.append(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "vault-doctor-list";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item.text;
      if (item.openId) {
        li.className = "vault-doctor-link";
        li.onclick = () => onOpen(item.openId!);
      }
      list.append(li);
    }
    section.append(list);
  }
  return section;
}

/** `titleToId` resolves a title to a note to open on click — only titles that exist in the
 *  current vault resolve (a broken link's target never does; that's what makes it broken). */
function renderReport(el: HTMLElement, report: VaultHealthReport, titleToId: Map<string, string>, onOpen: (id: string) => void): void {
  el.innerHTML = "";
  el.append(
    renderSection(
      "失效的笔记链接",
      report.brokenLinks.map((b) => ({ text: `${b.fromTitle} -> [[${b.target}]]`, openId: titleToId.get(b.fromTitle) })),
      onOpen,
    ),
    renderSection(
      "没有关联的笔记",
      report.orphanTitles.map((t) => ({ text: t, openId: titleToId.get(t) })),
      onOpen,
    ),
    renderSection(
      "标题重复的笔记",
      report.duplicateGroups.map((g) => ({ text: g.titles.join(", "), openId: titleToId.get(g.titles[0]) })),
      onOpen,
    ),
  );
}

const vaultDoctorPlugin: SolenPlugin = {
  id: "vault-doctor",
  name: "知识库检查",
  version: "0.1.0",

  onload(api) {
    api.commands.register({
      id: "vault-doctor.scan",
      name: "知识库检查：查找失效链接和重复标题",
      keywords: ["doctor", "audit", "broken", "orphan", "duplicate", "links"],
      run: () => {
        window.dispatchEvent(new CustomEvent("solen:plugin-panel-open", { detail: { id: "vault-doctor" } }));
      },
    });

    api.ui.registerPanel({
      id: "vault-doctor",
      title: "知识库检查",
      render(el) {
        // See wordcount.ts — render into an owned child, never overwrite el.className.
        const container = document.createElement("div");
        container.className = "vault-doctor-panel";
        el.append(container);
        let cancelled = false;

        async function refresh() {
          try {
            const summaries = await api.notes.list();
            const notes = await Promise.all(summaries.map((n) => api.notes.read(n.id)));
            if (cancelled) return;
            const titleToId = new Map(notes.map((n) => [n.title, n.id]));
            renderReport(container, auditVault(notes), titleToId, (id) => void api.notes.open(id));
          } catch (err) {
            if (cancelled) return;
            container.textContent = `知识库检查失败：${err instanceof Error ? err.message : String(err)}`;
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

export default vaultDoctorPlugin;
