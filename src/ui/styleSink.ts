import type { StyleSink } from "../palette/loader";

/** The id of the one `<style>` element the palettes live in (an id, not a class: the styles test scans for `nfe-` classes). */
export const PALETTE_STYLE_ID = "native-file-editor-palettes";

/**
 * One `<style>` in the document head, created on first use and replaced in
 * place on every reload, so its position in the cascade never moves. Obsidian
 * copies head styles into pop-out windows itself. The content is set through
 * `textContent`: it is CSS the user put in their own vault, never markup.
 */
export class DocumentStyleSink implements StyleSink {
  private readonly doc: () => Document;
  private el: HTMLStyleElement | null = null;

  constructor(doc: () => Document) {
    this.doc = doc;
  }

  set(css: string): void {
    if (!this.el) {
      const d = this.doc();
      this.el = d.createElement("style");
      this.el.id = PALETTE_STYLE_ID;
      d.head.appendChild(this.el);
    }
    this.el.textContent = css;
  }

  clear(): void {
    this.el?.remove();
    this.el = null;
  }
}
