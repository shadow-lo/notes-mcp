import { promises as fs } from "node:fs";
import path from "node:path";

export const NOTE_EXTENSIONS = [".md", ".markdown", ".mdx"];
export const MAX_NOTE_BYTES = 1024 * 1024;

const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);

export interface NoteMeta {
  /** Path relative to the notes root, always with forward slashes. */
  path: string;
  title: string;
  tags: string[];
  size: number;
  modified: string;
}

export interface Note extends NoteMeta {
  content: string;
}

export interface SearchHit extends NoteMeta {
  score: number;
  matches: { line: number; text: string }[];
}

export class NotesError extends Error {}

/** Resolve the configured root once, so every later check compares real paths. */
export async function resolveRoot(dir: string): Promise<string> {
  const real = await fs.realpath(path.resolve(dir)).catch(() => {
    throw new NotesError(`Notes folder not found: ${dir}`);
  });
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new NotesError(`Not a folder: ${dir}`);
  return real;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Turn a user-supplied relative path into an absolute one inside root.
 * Rejects `..` escapes, absolute paths and symlinks that point outside.
 */
export async function resolveNotePath(root: string, rel: string): Promise<string> {
  if (path.isAbsolute(rel)) throw new NotesError("Use a path relative to the notes folder");
  const target = path.resolve(root, rel);
  if (!isInside(root, target)) throw new NotesError(`Path escapes the notes folder: ${rel}`);
  const real = await fs.realpath(target).catch(() => {
    throw new NotesError(`Note not found: ${rel}`);
  });
  if (!isInside(root, real)) throw new NotesError(`Path escapes the notes folder: ${rel}`);
  return real;
}

function isNoteFile(name: string): boolean {
  return NOTE_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

async function* walk(root: string, dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(root, full);
    } else if (entry.isFile() && isNoteFile(entry.name)) {
      yield full;
    }
  }
}

/** Minimal frontmatter reader: `title: x` and `tags: [a, b]` or `tags: a, b`. */
export function parseFrontmatter(content: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { data: {}, body: content };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const raw of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, key, value] = kv;
    listKey = null;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: content.slice(match[0].length) };
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

function extractMeta(rel: string, content: string): { title: string; tags: string[] } {
  const { data, body } = parseFrontmatter(content);
  let tags: string[] = [];
  if (Array.isArray(data.tags)) tags = data.tags;
  else if (typeof data.tags === "string") tags = data.tags.split(",").map(unquote).filter(Boolean);
  // Inline #tags in the body, e.g. "#idea", but not markdown headings.
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) tags.push(m[1]);
  tags = [...new Set(tags.map((t) => t.replace(/^#/, "").toLowerCase()))];

  let title = typeof data.title === "string" ? data.title : "";
  if (!title) title = /^#\s+(.+)$/m.exec(body)?.[1].trim() ?? "";
  if (!title) title = path.basename(rel, path.extname(rel));
  return { title, tags };
}

async function loadNote(root: string, full: string): Promise<Note> {
  const stat = await fs.stat(full);
  if (stat.size > MAX_NOTE_BYTES) {
    throw new NotesError(`Note is larger than ${MAX_NOTE_BYTES} bytes`);
  }
  const content = await fs.readFile(full, "utf8");
  const rel = path.relative(root, full).split(path.sep).join("/");
  return {
    path: rel,
    ...extractMeta(rel, content),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    content,
  };
}

async function* allNotes(root: string): AsyncGenerator<Note> {
  for await (const full of walk(root, root)) {
    try {
      yield await loadNote(root, full);
    } catch {
      // Skip unreadable or oversized files instead of failing the whole call.
    }
  }
}

function meta({ content: _content, ...rest }: Note): NoteMeta {
  return rest;
}

export async function listNotes(
  root: string,
  opts: { folder?: string; tag?: string; limit?: number } = {},
): Promise<NoteMeta[]> {
  const prefix = opts.folder ? opts.folder.replace(/^\/+|\/+$/g, "") + "/" : "";
  const tag = opts.tag?.replace(/^#/, "").toLowerCase();
  const out: NoteMeta[] = [];
  for await (const note of allNotes(root)) {
    if (prefix && !note.path.startsWith(prefix)) continue;
    if (tag && !note.tags.includes(tag)) continue;
    out.push(meta(note));
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

export async function readNote(root: string, rel: string): Promise<Note> {
  const full = await resolveNotePath(root, rel);
  if (!isNoteFile(full)) throw new NotesError(`Not a markdown note: ${rel}`);
  return loadNote(root, full);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
    count++;
  }
  return count;
}

/**
 * Case-insensitive search. Every term must appear somewhere in the note
 * (title, tags, path or body). Title and tag hits rank above body hits.
 */
export async function searchNotes(
  root: string,
  query: string,
  opts: { limit?: number; tag?: string } = {},
): Promise<SearchHit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new NotesError("Query is empty");
  const tag = opts.tag?.replace(/^#/, "").toLowerCase();
  const hits: SearchHit[] = [];

  for await (const note of allNotes(root)) {
    if (tag && !note.tags.includes(tag)) continue;
    const title = note.title.toLowerCase();
    const { body: rawBody } = parseFrontmatter(note.content);
    const body = rawBody.toLowerCase();
    const where = `${title} ${note.path.toLowerCase()} ${note.tags.join(" ")} ${body}`;
    if (!terms.every((t) => where.includes(t))) continue;

    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 10;
      if (note.tags.some((tg) => tg.includes(t))) score += 5;
      if (note.path.toLowerCase().includes(t)) score += 2;
      score += Math.min(countOccurrences(body, t), 20);
    }

    const matches: SearchHit["matches"] = [];
    // Report line numbers in the original file, but only match the body.
    const offset = note.content.slice(0, note.content.length - rawBody.length).split("\n").length - 1;
    const lines = rawBody.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < 3; i++) {
      const lower = lines[i].toLowerCase();
      if (terms.some((t) => lower.includes(t))) {
        matches.push({ line: offset + i + 1, text: snippet(lines[i], terms) });
      }
    }
    hits.push({ ...meta(note), score, matches });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, opts.limit ?? 10);
}

function snippet(line: string, terms: string[], width = 160): string {
  const text = line.trim();
  if (text.length <= width) return text;
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  const start = Math.max(0, at - width / 2);
  return (start > 0 ? "…" : "") + text.slice(start, start + width) + (start + width < text.length ? "…" : "");
}
