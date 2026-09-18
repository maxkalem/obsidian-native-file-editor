/**
 * The one thing about a language the plugin has to know without being told:
 * whether it runs right to left, so its own dialogs and rows lay out
 * correctly. A localization file can say so itself (`"rtl": true`); this is
 * what answers when it does not.
 *
 * There is no list of languages anywhere in this plugin. One file decides
 * everything else about the language it carries (`core/localization.ts`).
 */

const RIGHT_TO_LEFT = ["ar", "he", "fa", "ur", "ps", "dv", "yi", "ckb", "sd", "ug"];

export function isRightToLeft(code: string): boolean {
  const base = code.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return RIGHT_TO_LEFT.includes(base);
}
