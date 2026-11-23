import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Create a temp notes folder from a { "rel/path.md": "content" } map. */
export async function makeNotes(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "notes-mcp-")));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

export const SAMPLE = {
  "projects/homelab.md":
    "---\ntitle: Homelab plan\ntags: [infra, postgres]\n---\n\n# Homelab\n\nMove the Postgres backup job to the NAS.\nBackup nightly.\n",
  "projects/ideas.md": "# Side ideas\n\n- notes search server #idea\n- backup checker #idea\n",
  "daily/2026-11-23.md": "---\ntags:\n  - log\n---\nWrote some notes about cooking.\n",
  "readme.txt": "not a note: backup",
  ".obsidian/workspace.md": "hidden backup",
};
