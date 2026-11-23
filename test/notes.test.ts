import { describe, expect, it, beforeAll } from "vitest";
import { symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  listNotes,
  parseFrontmatter,
  readNote,
  resolveRoot,
  searchNotes,
  NotesError,
} from "../src/notes.js";
import { makeNotes, SAMPLE } from "./helpers.js";

let root: string;
beforeAll(async () => {
  root = await resolveRoot(await makeNotes(SAMPLE));
});

describe("parseFrontmatter", () => {
  it("reads inline lists, block lists and scalars", () => {
    const { data, body } = parseFrontmatter(
      "---\ntitle: 'Hi'\ntags: [a, \"b\"]\nalias:\n  - x\n  - y\n---\nbody",
    );
    expect(data).toEqual({ title: "Hi", tags: ["a", "b"], alias: ["x", "y"] });
    expect(body).toBe("body");
  });

  it("returns the whole text when there is no frontmatter", () => {
    expect(parseFrontmatter("# T\n").body).toBe("# T\n");
  });
});

describe("listNotes", () => {
  it("finds markdown files, skips hidden folders and other extensions", async () => {
    const notes = await listNotes(root);
    expect(notes.map((n) => n.path)).toEqual([
      "daily/2026-11-23.md",
      "projects/homelab.md",
      "projects/ideas.md",
    ]);
  });

  it("derives titles from frontmatter, heading, then filename", async () => {
    const byPath = Object.fromEntries((await listNotes(root)).map((n) => [n.path, n.title]));
    expect(byPath["projects/homelab.md"]).toBe("Homelab plan");
    expect(byPath["projects/ideas.md"]).toBe("Side ideas");
    expect(byPath["daily/2026-11-23.md"]).toBe("2026-11-23");
  });

  it("collects frontmatter and inline tags", async () => {
    const notes = await listNotes(root, { tag: "#idea" });
    expect(notes.map((n) => n.path)).toEqual(["projects/ideas.md"]);
    expect((await listNotes(root, { tag: "log" })).length).toBe(1);
  });

  it("filters by folder", async () => {
    const notes = await listNotes(root, { folder: "projects/" });
    expect(notes).toHaveLength(2);
  });
});

describe("searchNotes", () => {
  it("ranks title/tag matches above body-only matches", async () => {
    const hits = await searchNotes(root, "postgres");
    expect(hits[0].path).toBe("projects/homelab.md");
    expect(hits[0].matches[0]).toEqual({ line: 8, text: "Move the Postgres backup job to the NAS." });
  });

  it("requires every term (AND)", async () => {
    expect((await searchNotes(root, "backup nas")).map((h) => h.path)).toEqual([
      "projects/homelab.md",
    ]);
    expect(await searchNotes(root, "backup cooking")).toEqual([]);
  });

  it("is case-insensitive and respects tag and limit", async () => {
    expect(await searchNotes(root, "BACKUP")).toHaveLength(2);
    expect(await searchNotes(root, "backup", { limit: 1 })).toHaveLength(1);
    expect((await searchNotes(root, "backup", { tag: "idea" })).map((h) => h.path)).toEqual([
      "projects/ideas.md",
    ]);
  });

  it("rejects an empty query", async () => {
    await expect(searchNotes(root, "   ")).rejects.toThrow(NotesError);
  });
});

describe("readNote", () => {
  it("reads a note by relative path", async () => {
    const note = await readNote(root, "projects/ideas.md");
    expect(note.content).toContain("notes search server");
  });

  it("blocks path traversal and absolute paths", async () => {
    await expect(readNote(root, "../etc/passwd")).rejects.toThrow(/escapes/);
    await expect(readNote(root, "/etc/passwd")).rejects.toThrow(/relative/);
  });

  it("blocks symlinks that point outside the folder", async () => {
    const outside = await makeNotes({ "secret.md": "top secret" });
    await symlink(path.join(outside, "secret.md"), path.join(root, "link.md"));
    await expect(readNote(root, "link.md")).rejects.toThrow(/escapes/);
  });

  it("refuses non-markdown files and missing notes", async () => {
    await expect(readNote(root, "readme.txt")).rejects.toThrow(/markdown/);
    await expect(readNote(root, "nope.md")).rejects.toThrow(/not found/);
  });

  it("refuses oversized notes", async () => {
    await writeFile(path.join(root, "big.md"), "x".repeat(1024 * 1024 + 1));
    await expect(readNote(root, "big.md")).rejects.toThrow(/larger/);
  });
});
