// TypeScript: types, generics, template strings, async.
import { readFile } from "node:fs/promises";

export interface Note {
  readonly path: string;
  readonly tags: string[];
  readonly size: number;
}

const LIMIT = 5 * 1024 * 1024;

export async function loadNote(path: string): Promise<Note | null> {
  const bytes = await readFile(path);
  if (bytes.byteLength > LIMIT) {
    console.warn(`skipping ${path}: ${bytes.byteLength} bytes`);
    return null;
  }
  const text = bytes.toString("utf8");
  const tags = [...text.matchAll(/#([\w-]+)/g)].map((m) => m[1] ?? "");
  return { path, tags, size: bytes.byteLength };
}

/** A generic helper with a constraint and a default. */
export function groupBy<T, K extends string = string>(items: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) (out[key(item)] ??= []).push(item);
  return out;
}
