// JavaScript: classes, private fields, async, destructuring, regex, template strings.
// Runs as it is in the plugin's sandbox (Run): no imports, no DOM, console only.

class Note {
  #size = 0;
  constructor(path, text = "") {
    this.path = path;
    this.tags = [...text.matchAll(/#([\w-]+)/g)].map(([, tag]) => tag);
    this.#size = text.length;
  }
  static async load(path, text) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Note(path, text);
  }
  get large() {
    return this.#size > 5 * 1024 * 1024;
  }
}

(async () => {
  const { path, tags, large } = await Note.load("a.md", "Notes on #obsidian and #code-editors, revised 2026-09-09.");
  console.log(`${path}: ${tags.length} tags`, tags.length === 0 ? null : tags);
  console.log(`large: ${large}`);
  console.error("stderr goes red");
})();
