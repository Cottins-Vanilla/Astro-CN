import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getGraphTool,
  getVaultFileGraphTool,
  listCanvasesTool,
  listNotesTool,
  readCanvasTool,
  readNoteTool,
  searchNotesTool,
  writeNoteTool,
} from "./tools.js";
import { readAllNotes } from "./vaultReader.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/**
 * Build an MCP server exposing a vault (a directory following
 * docs/DATA-FORMAT.md) to any MCP-capable client. Reads fresh from disk on
 * every call — no watching, no cache — see vaultReader.ts.
 *
 * `vault` may be a getter rather than a fixed path: index.ts passes one that re-reads Astro's
 * currently-open vault, so a client that connected once keeps following the app across vault
 * switches without restarting its server process.
 */
export function createServer(vault: string | (() => string)): McpServer {
  const vaultDir = typeof vault === "string" ? () => vault : vault;
  const server = new McpServer({ name: "solen-mcp-server", version: "0.1.0" });

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List every note in the vault with its id, title, tags, and last-updated time (no body). Use this to " +
        "get an overview of the vault or to find a note's id before calling read_note or write_note.",
      inputSchema: {},
    },
    async () => json(await listNotesTool(vaultDir())),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description:
        "Read a single note's full Markdown body plus its frontmatter (id, title, tags, timestamps). Identify " +
        "the note by id (exact) or title (case-insensitive). Provide exactly one.",
      inputSchema: {
        id: z.string().optional().describe("The note's id, e.g. \"n_x1y2z3\"."),
        title: z.string().optional().describe("The note's title, matched case-insensitively."),
      },
    },
    async ({ id, title }) => {
      if (!id && !title) return { content: [{ type: "text", text: "Error: provide either id or title." }], isError: true };
      try {
        return json(await readNoteTool(vaultDir(), { id, title }));
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Case-insensitive substring search over every note's title and body. Returns matches with a snippet " +
        "(the matching line, plus one line of context on either side). Use this to find notes about a topic " +
        "before reading them in full with read_note.",
      inputSchema: {
        query: z.string().min(1).describe("Substring to search for, e.g. \"distributed systems\"."),
      },
    },
    async ({ query }) => json(await searchNotesTool(vaultDir(), query)),
  );

  server.registerTool(
    "write_note",
    {
      title: "Write note",
      description:
        "Create a new note, or overwrite an existing one's title and body when `id` is given. Writes a " +
        "Markdown file with frontmatter to notes/<id>.md and updates updatedAt. Wiki-links (`[[Title]]`) and " +
        "#hashtags in the body work the same as notes written from the app.",
      inputSchema: {
        title: z.string().min(1).describe("Note title."),
        body: z.string().describe("Markdown body (everything below the frontmatter)."),
        id: z.string().optional().describe("Id of an existing note to overwrite; omit to create a new note."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, body, id }) => {
      try {
        return json(await writeNoteTool(vaultDir(), { title, body, id }));
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_canvases",
    {
      title: "List canvases",
      description: "List every canvas in the vault with its id, name, and last-updated time (no nodes/edges).",
      inputSchema: {},
    },
    async () => json(await listCanvasesTool(vaultDir())),
  );

  server.registerTool(
    "read_canvas",
    {
      title: "Read canvas",
      description:
        "Read a canvas's full .scanvas JSON document (nodes and edges). Identify the canvas by id (exact) or " +
        "name (case-insensitive). Provide exactly one.",
      inputSchema: {
        id: z.string().optional().describe("The canvas's id, e.g. \"c_a1b2c3\"."),
        name: z.string().optional().describe("The canvas's name, matched case-insensitively."),
      },
    },
    async ({ id, name }) => {
      if (!id && !name) return { content: [{ type: "text", text: "Error: provide either id or name." }], isError: true };
      try {
        return json(await readCanvasTool(vaultDir(), { id, name }));
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_graph",
    {
      title: "Get knowledge graph",
      description:
        "Get the vault's derived knowledge graph: nodes (one per note, plus 'ghost' nodes for unresolved " +
        "wiki-links) and edges (from note wiki-links and from note-to-note connections on canvases).",
      inputSchema: {},
    },
    async () => json(await getGraphTool(vaultDir())),
  );

  server.registerTool(
    "get_vault_file_graph",
    {
      title: "Get vault file graph",
      description:
        "Get a graph of every file and folder in the vault — any file type, not just Astro notes. Nodes are " +
        "files/folders (id, name, extension, size, updatedAt); edges are folder containment plus 'mentions' " +
        "(one text file's content includes another file's name). Use this to explore or query a vault's " +
        "arbitrary files (code, docs, configs, images as nodes) far more cheaply than reading them all in full.",
      inputSchema: {},
    },
    async () => json(await getVaultFileGraphTool(vaultDir())),
  );

  server.registerResource(
    "note",
    new ResourceTemplate("solen://notes/{id}", {
      list: async () => {
        const notes = await readAllNotes(vaultDir());
        return {
          resources: notes.map((note) => ({
            uri: `solen://notes/${note.id}`,
            name: note.title,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    { title: "Note", description: "A single note's Markdown body with frontmatter.", mimeType: "text/markdown" },
    async (uri, { id }) => {
      const noteId = Array.isArray(id) ? id[0] : id;
      const notes = await readAllNotes(vaultDir());
      const note = notes.find((n) => n.id === noteId);
      if (!note) throw new Error(`Note not found: ${noteId}`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: note.body }] };
    },
  );

  return server;
}
