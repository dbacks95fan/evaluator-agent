// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Read-only tools the reviewing model may call: list, read, search, and diff the candidate checkout.
// ABOUTME: Paths are confined to the workspace, .git is refused, and output is capped; refusals return as text.
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { truncateMiddle } from "./commands.js";
import { confineToWorkspace } from "./paths.js";

export const MAX_LIST_ENTRIES = 500;
export const MAX_READ_BYTES = 64 * 1024;
export const MAX_SEARCH_MATCHES = 100;
export const MAX_SEARCH_FILES = 4000;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

/** Skipped when walking for search; still readable by explicit path, except .git. */
const WALK_SKIP = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".venv",
  "__pycache__",
  ".next",
  "coverage",
]);

export interface ReadToolContext {
  workspace: string;
  /** `git diff` of the candidate against the accepted base, optionally limited to one path. */
  diff: (path: string | null) => Promise<string>;
  maxOutputChars: number;
}

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "list_directory",
    description: "List a directory in the candidate checkout. Directories end with '/'.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Repository-relative path; '.' for the root." } },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "read_file",
    description: `Read a UTF-8 text file from the candidate checkout, up to ${MAX_READ_BYTES} bytes from a byte offset.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository-relative file path." },
        offset: { type: ["integer", "null"], description: "Byte offset to start from; null for 0." },
      },
      required: ["path", "offset"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "search_files",
    description: `Case-insensitive literal text search in the candidate checkout. Returns up to ${MAX_SEARCH_MATCHES} 'path:line: text' matches.`,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Literal text to find." },
        path: { type: ["string", "null"], description: "Repository-relative directory to search; null for the root." },
      },
      required: ["text", "path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "show_diff",
    description:
      "Show the unified diff of the candidate against the accepted product base, excluding .agent/ workflow records.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: ["string", "null"],
          description: "Limit the diff to one repository-relative path; null for all.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
] as const;

class ToolError extends Error {}

function resolveInside(workspace: string, supplied: unknown): { rel: string; full: string } {
  if (typeof supplied !== "string" || !supplied.trim()) throw new ToolError("path must be a non-empty string");
  let rel: string;
  try {
    rel = confineToWorkspace(workspace, supplied);
  } catch (err) {
    throw new ToolError((err as Error).message);
  }
  if (rel === ".git" || rel.startsWith(".git/")) throw new ToolError("the .git directory is not readable");
  return { rel, full: rel === "." ? workspace : join(workspace, rel) };
}

function listDirectory(ctx: ReadToolContext, path: unknown): string {
  const { full, rel } = resolveInside(ctx.workspace, path);
  if (!statSync(full, { throwIfNoEntry: false })?.isDirectory()) throw new ToolError(`${rel} is not a directory`);
  const entries = readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
  const shown = entries.slice(0, MAX_LIST_ENTRIES);
  const more = entries.length > shown.length ? [`... ${entries.length - shown.length} more entries not shown`] : [];
  return [...shown, ...more].join("\n") || "(empty directory)";
}

function readFile(ctx: ReadToolContext, path: unknown, offset: unknown): string {
  const { full, rel } = resolveInside(ctx.workspace, path);
  if (!statSync(full, { throwIfNoEntry: false })?.isFile()) throw new ToolError(`${rel} is not a file`);
  const start = offset === null || offset === undefined ? 0 : Number(offset);
  if (!Number.isInteger(start) || start < 0) throw new ToolError("offset must be a non-negative integer");
  const bytes = readFileSync(full);
  const slice = bytes.subarray(start, start + MAX_READ_BYTES);
  if (slice.includes(0)) throw new ToolError(`${rel} looks binary and was not read`);
  const end = start + slice.length;
  const more =
    end < bytes.length ? `\n... truncated at byte ${end} of ${bytes.length}; call again with offset ${end}` : "";
  return slice.toString("utf8") + more;
}

function searchFiles(ctx: ReadToolContext, text: unknown, path: unknown): string {
  if (typeof text !== "string" || !text) throw new ToolError("text must be a non-empty string");
  const { full, rel } = resolveInside(ctx.workspace, path ?? ".");
  if (!statSync(full, { throwIfNoEntry: false })?.isDirectory()) throw new ToolError(`${rel} is not a directory`);
  const needle = text.toLowerCase();
  const matches: string[] = [];
  let scanned = 0;
  const walk = (dir: string, relDir: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryRel = relDir === "." ? entry.name : `${relDir}/${entry.name}`;
      const entryFull = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name) && walk(entryFull, entryRel)) return true;
        continue;
      }
      if (!entry.isFile() || lstatSync(entryFull).isSymbolicLink()) continue;
      if (++scanned > MAX_SEARCH_FILES) {
        matches.push(`... stopped after ${MAX_SEARCH_FILES} files`);
        return true;
      }
      if (statSync(entryFull).size > MAX_SEARCH_FILE_BYTES) continue;
      const data = readFileSync(entryFull);
      if (data.includes(0)) continue;
      const lines = data.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        matches.push(`${entryRel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
        if (matches.length >= MAX_SEARCH_MATCHES) {
          matches.push("... match limit reached");
          return true;
        }
      }
    }
    return false;
  };
  walk(full, rel);
  return matches.join("\n") || "(no matches)";
}

async function showDiff(ctx: ReadToolContext, path: unknown): Promise<string> {
  let limited: string | null = null;
  if (path !== null && path !== undefined) limited = resolveInside(ctx.workspace, path).rel;
  return (await ctx.diff(limited)) || "(no differences)";
}

/** Runs one model tool call. Refusals and bad arguments come back as text, never as an exception. */
export async function runReadTool(ctx: ReadToolContext, name: string, rawArguments: string): Promise<string> {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = rawArguments ? JSON.parse(rawArguments) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "error: arguments must be a JSON object";
    args = parsed as Record<string, unknown>;
  } catch {
    return "error: arguments were not valid JSON";
  }
  try {
    let output: string;
    switch (name) {
      case "list_directory":
        output = listDirectory(ctx, args.path);
        break;
      case "read_file":
        output = readFile(ctx, args.path, args.offset);
        break;
      case "search_files":
        output = searchFiles(ctx, args.text, args.path);
        break;
      case "show_diff":
        output = await showDiff(ctx, args.path);
        break;
      default:
        return `error: unknown tool "${name}"`;
    }
    return truncateMiddle(output, ctx.maxOutputChars);
  } catch (err) {
    if (err instanceof ToolError) return `error: ${err.message}`;
    throw err;
  }
}
