#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveRoot } from "./notes.js";
import { createServer, VERSION } from "./server.js";

const USAGE = `notes-mcp ${VERSION}
Usage: notes-mcp <notes-folder>
   or: NOTES_DIR=<notes-folder> notes-mcp`;

async function main() {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    return;
  }
  if (arg === "--version" || arg === "-v") {
    console.log(VERSION);
    return;
  }
  const dir = arg ?? process.env.NOTES_DIR;
  if (!dir) {
    console.error(USAGE);
    process.exit(2);
  }
  const root = await resolveRoot(dir);
  const server = createServer(root);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel, so log to stderr only.
  console.error(`notes-mcp serving ${root}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
