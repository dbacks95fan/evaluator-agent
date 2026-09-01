import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import YAML from "yaml";

export async function readStructuredFile<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  const ext = extname(path).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") return YAML.parse(text) as T;
  return JSON.parse(text) as T;
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("Codex did not return a JSON object");
    return JSON.parse(trimmed.slice(first, last + 1));
  }
}
