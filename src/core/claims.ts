import { OBSIDIAN_OWNED_EXTENSIONS } from "../constants";

/**
 * Which extensions this plugin registers at load: cover everything, yield by
 * default. `registerExtensions` overwrites another plugin's claim silently and
 * the winner would depend on load order, so an extension that already has an
 * owner is left alone unless the user turned its toggle on deliberately.
 */

export interface ClaimInput {
  /** Extensions the registry knows, lower-case, without the dot. */
  readonly candidates: readonly string[];
  /** Extension -> view type of whoever owns it right now, from Obsidian's view registry. */
  readonly owned: Readonly<Record<string, string>>;
  /**
   * The user's per-extension toggles. `true` takes the extension even from an
   * owner, `false` never takes it, absent means the default rule.
   */
  readonly toggles: Readonly<Record<string, boolean>>;
}

export interface ClaimDecision {
  /** Extensions to register, in candidate order. */
  readonly take: string[];
  /** Left to their current owner by the default rule. */
  readonly yielded: Array<{ ext: string; viewType: string }>;
  /** Turned off by the user. */
  readonly disabled: string[];
}

export function decideClaims(input: ClaimInput): ClaimDecision {
  const take: string[] = [];
  const yielded: Array<{ ext: string; viewType: string }> = [];
  const disabled: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.candidates) {
    const ext = raw.toLowerCase();
    if (seen.has(ext)) continue;
    seen.add(ext);
    // Obsidian's own views are never a candidate, whatever a toggle says: taking
    // one would replace the Markdown or PDF view.
    if (OBSIDIAN_OWNED_EXTENSIONS.has(ext)) continue;
    const toggle = input.toggles[ext];
    if (toggle === false) {
      disabled.push(ext);
      continue;
    }
    const owner = input.owned[ext];
    if (owner !== undefined && toggle !== true) {
      yielded.push({ ext, viewType: owner });
      continue;
    }
    take.push(ext);
  }
  return { take, yielded, disabled };
}

/**
 * One sentence for the notice, grouped by owner so the user reads "left .ts,
 * .js to cm-code-editor" rather than one line per extension.
 */
export function describeYielded(yielded: ReadonlyArray<{ ext: string; viewType: string }>): string {
  const byOwner = new Map<string, string[]>();
  for (const y of yielded) {
    const list = byOwner.get(y.viewType) ?? [];
    list.push(`.${y.ext}`);
    byOwner.set(y.viewType, list);
  }
  const parts = [...byOwner.entries()].map(([owner, exts]) => `${exts.join(", ")} to ${owner}`);
  return `Native File Editor left ${parts.join("; ")}. Take them over per extension in its settings.`;
}
