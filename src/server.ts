import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listNotes, NotesError, readNote, searchNotes, type NoteMeta } from "./notes.js";

export const VERSION = "0.1.0";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function fail(err: unknown) {
  const message = err instanceof NotesError ? err.message : `Unexpected error: ${String(err)}`;
  return { ...text(message), isError: true };
}

function line(n: NoteMeta): string {
  const tags = n.tags.length ? `  [${n.tags.map((t) => `#${t}`).join(" ")}]` : "";
  return `- ${n.path} — ${n.title}${tags}`;
}

/** Build the MCP server for one notes folder. `root` must come from resolveRoot(). */
export function createServer(root: string): McpServer {
  const server = new McpServer({ name: "notes-mcp", version: VERSION });

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Full-text search over the user's markdown notes. All words in the query must appear in a note. " +
        "Returns the best matches with paths and matching lines; call read_note to get a full note.",
      inputSchema: {
        query: z.string().min(1).describe("Words to look for, e.g. 'postgres backup'"),
        tag: z.string().optional().describe("Only search notes with this tag (without #)"),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum results"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, tag, limit }) => {
      try {
        const hits = await searchNotes(root, query, { tag, limit });
        if (hits.length === 0) return text(`No notes match "${query}".`);
        const out = hits.map((h) =>
          [line(h), ...h.matches.map((m) => `    L${m.line}: ${m.text}`)].join("\n"),
        );
        return text(`${hits.length} note(s) match "${query}":\n\n${out.join("\n")}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description: "Read one markdown note in full, by the path that list_notes or search_notes returned.",
      inputSchema: {
        path: z.string().min(1).describe("Path relative to the notes folder, e.g. 'projects/ideas.md'"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        const note = await readNote(root, path);
        return text(note.content);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List notes with their titles and tags, optionally filtered by folder or tag.",
      inputSchema: {
        folder: z.string().optional().describe("Only notes under this subfolder"),
        tag: z.string().optional().describe("Only notes with this tag (without #)"),
        limit: z.number().int().min(1).max(500).default(100).describe("Maximum results"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ folder, tag, limit }) => {
      try {
        const notes = await listNotes(root, { folder, tag, limit });
        if (notes.length === 0) return text("No notes found.");
        return text(notes.map(line).join("\n"));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerResource(
    "note",
    new ResourceTemplate("note:///{+path}", {
      list: async () => ({
        resources: (await listNotes(root, { limit: 500 })).map((n) => ({
          uri: `note:///${n.path}`,
          name: n.title,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "Markdown note", mimeType: "text/markdown" },
    async (uri, { path }) => {
      const note = await readNote(root, decodeURIComponent(String(path)));
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: note.content }] };
    },
  );

  return server;
}
