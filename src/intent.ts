import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface ParsedIntent {
  workItem: string;
  status: string;
  reviewUrl?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  openDecisions: string[];
  sha256: string;
}

function value(markdown: string, label: string): string | undefined {
  const match = markdown.match(new RegExp(`^-\\s*\\*\\*${label}:\\*\\*\\s*(.+)$`, "mi"));
  return match?.[1]?.trim();
}

export async function readIntent(path: string): Promise<ParsedIntent> {
  const raw = await readFile(path, "utf8");
  const workItem = value(raw, "Work ID");
  const status = value(raw, "Status");
  if (!workItem || !status) throw new Error("Intent is missing Identity Work ID or Status");

  // Limit whitespace after the heading to its own line so an empty section cannot absorb the next heading.
  const decisions = raw.match(/## Open decisions[ \t]*\r?\n([\s\S]*?)(?=\r?\n## |\s*$)/i)?.[1] ?? "";
  return {
    workItem,
    status,
    reviewUrl: value(raw, "Review URL"),
    acceptedBy: value(raw, "Accepted by"),
    acceptedAt: value(raw, "Accepted at"),
    openDecisions: [...decisions.matchAll(/^\s*-\s+(.+)$/gm)].map((m) => m[1].trim()),
    sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
  };
}
