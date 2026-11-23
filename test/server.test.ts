import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolveRoot } from "../src/notes.js";
import { createServer } from "../src/server.js";
import { makeNotes, SAMPLE } from "./helpers.js";

let client: Client;

beforeAll(async () => {
  const root = await resolveRoot(await makeNotes(SAMPLE));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(root).connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});

afterAll(() => client?.close());

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join("");
}

describe("MCP server", () => {
  it("exposes three read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_notes", "read_note", "search_notes"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("search_notes returns paths and matching lines", async () => {
    const res = await client.callTool({ name: "search_notes", arguments: { query: "postgres" } });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain("projects/homelab.md — Homelab plan");
    expect(textOf(res)).toContain("L8: Move the Postgres backup job");
  });

  it("read_note returns the full note", async () => {
    const res = await client.callTool({ name: "read_note", arguments: { path: "projects/ideas.md" } });
    expect(textOf(res)).toBe(SAMPLE["projects/ideas.md"]);
  });

  it("read_note reports traversal as a tool error, not a crash", async () => {
    const res = await client.callTool({ name: "read_note", arguments: { path: "../x.md" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/escapes/);
  });

  it("list_notes filters by tag", async () => {
    const res = await client.callTool({ name: "list_notes", arguments: { tag: "idea" } });
    expect(textOf(res)).toBe("- projects/ideas.md — Side ideas  [#idea]");
  });

  it("serves notes as resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("note:///projects/homelab.md");
    const { contents } = await client.readResource({ uri: "note:///projects/ideas.md" });
    expect((contents[0] as { text: string }).text).toBe(SAMPLE["projects/ideas.md"]);
  });
});
