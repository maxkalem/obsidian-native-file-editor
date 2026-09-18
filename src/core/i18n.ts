import { EN } from "../i18n/en";

/**
 * Translation. English is the source and the only catalogue inside the plugin,
 * because a community install copies `main.js`, `manifest.json` and
 * `styles.css` and nothing else; every other locale is a JSON file the user
 * puts into the locale folder of the vault (`core/vaultLocales.ts` reads it).
 *
 * Two rules keep this honest. A key missing from the loaded locale falls back
 * to English, so a half-translated file is useful from its first line rather
 * than broken. And nothing is translated at module load: `t()` is called when
 * the text is built, so a change of locale shows in the next menu, dialog or
 * settings page without reloading the plugin.
 *
 * A pure module: strings in, strings out, no Obsidian.
 */

export type Catalogue = Readonly<Record<string, string>>;

/** The English catalogue itself, for the template writer; every other reader goes through `t()`. */
export const EN_CATALOGUE: Catalogue = EN;

export interface LoadedLocale {
  /** The locale code, `uk`, `zh-CN`; `en` is the built-in one. */
  readonly code: string;
  /** The language's name in its own language, for the dropdown. */
  readonly name: string;
  readonly strings: Catalogue;
}

const ENGLISH: LoadedLocale = { code: "en", name: "English", strings: EN };

let active: LoadedLocale = ENGLISH;

/** Put a locale in force, or English when it is null. */
export function setLocale(locale: LoadedLocale | null): void {
  active = locale ?? ENGLISH;
}

export function activeLocale(): LoadedLocale {
  return active;
}

/** Every key the plugin knows, which is every key of the English catalogue. */
export function knownKeys(): string[] {
  return Object.keys(EN);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** `{name}` is replaced by the value; a value that is not given is left as it is, so a broken translation shows the placeholder rather than "undefined". */
export function formatMessage(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The text of `key` in the locale in force, the English text when the locale
 * does not have it, and the key itself when English does not either — which
 * can only happen if a caller invents a key, and is loud enough to be caught
 * by the test that compares the two.
 */
export function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  const own = active.strings[key];
  const template = own !== undefined && own.length > 0 ? own : (EN[key] ?? key);
  return formatMessage(template, params);
}

/**
 * The English and the `other` form by a count. English needs two; a language
 * that needs more writes the whole sentence into the `other` string and lives
 * with it, which is the price of keeping the catalogue a flat map of strings.
 */
export function plural(count: number, oneKey: string, otherKey: string, params?: Readonly<Record<string, string | number>>): string {
  return t(count === 1 ? oneKey : otherKey, { count, ...params });
}
