/**
 * A vault-wide file graph — every file in the vault folder (any type, not just Astro notes),
 * connected by folder containment and by simple cross-references (one file's text content
 * mentioning another file's name). This is deliberately lighter than a full AST-aware knowledge
 * graph (see docs/ARCH-VAULT-STORAGE.md's graphify research): no per-language parsing, just
 * filename-substring matching — enough to turn "a folder of arbitrary files" into a queryable
 * graph an LLM (or the MCP server's `get_vault_file_graph` tool) can walk without reading every
 * file in full.
 */

export interface VaultFileNode {
  /** POSIX-separated path relative to the vault root — stable, unique, used as the node id. */
  id: string;
  name: string;
  /** Lowercased extension including the dot ("" for extensionless files and directories). */
  ext: string;
  isDir: boolean;
  size: number;
  updatedAt: string;
}

export interface VaultFileEdge {
  from: string;
  to: string;
  kind: "contains" | "mentions";
}

export interface VaultFileGraph {
  nodes: VaultFileNode[];
  edges: VaultFileEdge[];
}

function parentIdOf(id: string): string | undefined {
  const i = id.lastIndexOf("/");
  return i === -1 ? undefined : id.slice(0, i);
}

/** Names shorter than this are too generic to safely substring-match (e.g. "id", "a") — matching
 * them would flood the graph with false-positive "mentions" edges. */
const MIN_MENTION_NAME_LENGTH = 3;

/**
 * Builds the graph: a `contains` edge from every file/folder to its parent folder, plus a
 * `mentions` edge whenever a text file's content includes another file's name (sans extension,
 * case-insensitive) — the same lightweight heuristic `[[wiki-link]]` resolution uses, generalized
 * from note titles to arbitrary filenames.
 */
export function buildVaultFileGraph(nodes: VaultFileNode[], textContents: ReadonlyMap<string, string>): VaultFileGraph {
  const edges: VaultFileEdge[] = [];

  for (const node of nodes) {
    const parent = parentIdOf(node.id);
    if (parent !== undefined) edges.push({ from: parent, to: node.id, kind: "contains" });
  }

  const fileNames = nodes
    .filter((n) => !n.isDir)
    .map((n) => ({ id: n.id, bare: n.name.replace(/\.[^./]+$/, "").toLowerCase() }))
    .filter((n) => n.bare.length >= MIN_MENTION_NAME_LENGTH);

  for (const [id, content] of textContents) {
    const lower = content.toLowerCase();
    for (const target of fileNames) {
      if (target.id === id) continue;
      if (lower.includes(target.bare)) edges.push({ from: id, to: target.id, kind: "mentions" });
    }
  }

  return { nodes, edges };
}
