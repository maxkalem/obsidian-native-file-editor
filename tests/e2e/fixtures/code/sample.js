// JavaScript: classes, async, destructuring, regex.
import { readFile } from "node:fs/promises";

export class Note {
  #size = 0;
  constructor(path, tags = []) {
    this.path = path;
    this.tags = tags;
  }
  static async load(path) {
    const text = await readFile(path, "utf8");
    const tags = [...text.matchAll(/#([\w-]+)/g)].map(([, t]) => t);
    return new Note(path, tags);
  }
  get large() { return this.#size > 5 * 1024 * 1024; }
}

const { path, tags } = await Note.load("a.md");
console.log(`${path}: ${tags.length} tags`, tags.length === 0 ? null : tags);
