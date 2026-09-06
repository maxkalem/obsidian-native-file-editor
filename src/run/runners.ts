import { languageFor, languageNamed } from "../highlight/registry";

/**
 * Runner definitions: how a file of one LANGUAGE becomes a process, as data.
 * Keyed by the registry's language name (`Python`, `JavaScript`), so one row
 * in settings covers every extension of the language. Pure apart from the
 * registry lookups; `process.ts` runs what this expands; the settings tab
 * edits the list; the defaults ship in the bundle and name only each
 * language's own standard tool (ADR-004). Everything here is device-local.
 */

export interface RunnerDef {
  /** The registry language name this runner applies to, e.g. `Python`. */
  readonly language: string;
  /** Shown in the panel's runner dropdown when a language has several. */
  readonly name: string;
  /** One process: the interpreter and its arguments, each its own element. */
  readonly argv?: readonly string[];
  /** Several processes in order (compile, then run); stops at the first non-zero exit. */
  readonly steps?: ReadonlyArray<readonly string[]>;
  /** A placeholder whose expansion is fed to the process's stdin as text (`{file}`), for tools that read a script from stdin. */
  readonly stdin?: string;
  /**
   * `worker`: the JavaScript sandbox, no process. `page`: render the file as a
   * web page inside Obsidian (a sandboxed iframe), no process. Absent means a
   * process: the user's interpreter.
   */
  readonly kind?: "process" | "worker" | "page";
}

/** What the placeholders expand to for one run. All absolute OS paths. */
export interface RunContext {
  readonly file: string;
  readonly dir: string;
  readonly stem: string;
  /** A per-run temp directory outside the vault, created before and removed after. */
  readonly tmp: string;
}

/**
 * What the plugin can do for a language without any interpreter of the user's:
 * JavaScript runs in the Web Worker sandbox, a web page (HTML, MHTML) is
 * rendered inside Obsidian. These are offered only when the user has added no
 * interpreter for that language; an added interpreter replaces them (USER,
 * 2026-09-06). The list of user interpreters starts EMPTY: nothing is shown
 * that cannot be changed.
 */
export const BUILTIN_RUNNERS: readonly RunnerDef[] = [
  { language: "JavaScript", name: "Sandbox (Web Worker)", kind: "worker" },
  { language: "HTML", name: "Page (inside Obsidian)", kind: "page" },
  { language: "MHTML", name: "Page (inside Obsidian)", kind: "page" },
];

/**
 * Compile-then-run languages: the steps that follow the compiler the user
 * picks (`{program}` is replaced by it). The second step runs what the first
 * produced; Kotlin's needs `java` on PATH.
 */
export const STANDARD_STEPS: Readonly<Record<string, ReadonlyArray<readonly string[]>>> = {
  Rust: [["{program}", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}"]],
  "C/C++": [["{program}", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}"]],
  Kotlin: [["{program}", "{file}", "-include-runtime", "-d", "{tmp}/{stem}.jar"], ["java", "-jar", "{tmp}/{stem}.jar"]],
  Go: [["{program}", "build", "-o", "{tmp}/{stem}", "{file}"], ["{tmp}/{stem}"]],
};

/** A new runner for a language around the program the user picked: its standard steps or arguments, else `program {file}`. */
export function runnerForProgram(language: string, program: string): RunnerDef {
  const name = program.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
  const steps = STANDARD_STEPS[language];
  if (steps) return { language, name, steps: steps.map((step) => step.map((a) => (a === "{program}" ? program : a))) };
  const argv = STANDARD_COMMANDS[language];
  return { language, name, argv: argv ? [program, ...argv.slice(1)] : [program, "{file}"] };
}

/**
 * The bare command each language's standard tool answers to: the arguments
 * after the program the user picks, and the suggestion in the file dialog.
 */
export const STANDARD_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  JavaScript: ["node", "{file}"],
  TypeScript: ["node", "--experimental-strip-types", "{file}"],
  Python: ["python", "{file}"],
  Lua: ["lua", "{file}"],
  Ruby: ["ruby", "{file}"],
  Perl: ["perl", "{file}"],
  PHP: ["php", "{file}"],
  Shell: ["bash", "{file}"],
  PowerShell: ["pwsh", "-NoProfile", "-File", "{file}"],
  Batch: ["cmd", "/c", "{file}"],
  R: ["Rscript", "{file}"],
  Java: ["java", "{file}"],
  "C#": ["dotnet", "run", "--project", "{dir}"],
  Swift: ["swift", "{file}"],
  Dart: ["dart", "run", "{file}"],
  Julia: ["julia", "{file}"],
  Scheme: ["racket", "{file}"],
  Clojure: ["clojure", "-M", "{file}"],
  Erlang: ["escript", "{file}"],
  Haskell: ["runghc", "{file}"],
  OCaml: ["ocaml", "{file}"],
  "F#": ["dotnet", "fsi", "{file}"],
  Tcl: ["tclsh", "{file}"],
  Elixir: ["elixir", "{file}"],
  Nim: ["nim", "r", "--hints:off", "{file}"],
  Raku: ["raku", "{file}"],
  GDScript: ["godot", "--headless", "--script", "{file}"],
  HTML: ["msedge", "{file}"],
  MHTML: ["msedge", "{file}"],
};

const PLACEHOLDER = /\{(file|dir|stem|tmp)\}/g;

/** One argument with its placeholders replaced. A placeholder may sit inside a longer element (`{tmp}/{stem}.jar`). */
export function expandArg(arg: string, ctx: RunContext): string {
  return arg.replace(PLACEHOLDER, (_, name: string) => ctx[name as keyof RunContext]);
}

export function expandArgv(argv: readonly string[], ctx: RunContext): string[] {
  return argv.map((a) => expandArg(a, ctx));
}

/** The processes a runner starts, in order: its `steps`, or its single `argv`. Empty for a worker or open runner. */
export function stepsOf(def: RunnerDef): ReadonlyArray<readonly string[]> {
  if (def.steps) return def.steps;
  if (def.argv) return [def.argv];
  return [];
}

/**
 * A path that could break out of an argv element into the argument parser of
 * the program itself (newline) or end a C string early (NUL) is refused before
 * any process starts. Nothing else is escaped: argv elements are passed as-is.
 */
export function refusePath(path: string): string | null {
  if (path.includes("\0")) return "the file path contains a NUL character";
  if (/[\r\n]/.test(path)) return "the file path contains a line break";
  return null;
}

/** Why a definition cannot run, or null when it is usable. */
export function validateRunner(def: RunnerDef): string | null {
  if (typeof def.language !== "string" || def.language.trim().length === 0) return "runner has no language";
  if (typeof def.name !== "string" || def.name.trim().length === 0) return `runner for ${def.language} has no name`;
  if (def.kind === "worker" || def.kind === "page") return def.argv || def.steps ? `${def.kind} runner "${def.name}" must not have argv or steps` : null;
  const steps = stepsOf(def);
  if (steps.length === 0) return `runner "${def.name}" has neither argv nor steps`;
  for (const step of steps) {
    if (!Array.isArray(step) || step.length === 0) return `runner "${def.name}" has an empty step`;
    for (const a of step) if (typeof a !== "string" || a.length === 0) return `runner "${def.name}" has an empty argument`;
    if ((step[0] ?? "").includes("{file}")) return `runner "${def.name}" uses the file as the command`;
  }
  if (def.stdin !== undefined && (typeof def.stdin !== "string" || def.stdin.length === 0)) return `runner "${def.name}" has an empty stdin`;
  return null;
}

/**
 * The runners that apply to a file extension: the user's interpreters for the
 * language the registry gives it, or, when there are none, what the plugin can
 * do by itself for that language (sandbox, page). An added interpreter
 * replaces the built-in behaviour rather than joining it.
 */
export function runnersFor(ext: string, runners: readonly RunnerDef[]): RunnerDef[] {
  const language = languageFor(ext)?.name;
  if (language === undefined) return [];
  const own = runners.filter((r) => r.language === language);
  if (own.length > 0) return own;
  return BUILTIN_RUNNERS.filter((r) => r.language === language);
}

/** Whether the registry knows the language a runner names; a runner for an unknown language is kept but never offered. */
export function runnerLanguageExists(def: RunnerDef): boolean {
  return languageNamed(def.language) !== null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

/**
 * Runner definitions from storage: anything that is not a valid definition is
 * dropped and named, so one bad entry never takes the others down. Returns
 * null when the input is not a list at all.
 */
export function normalizeRunners(raw: unknown): { runners: RunnerDef[]; rejected: string[] } | null {
  if (!Array.isArray(raw)) return null;
  const runners: RunnerDef[] = [];
  const rejected: string[] = [];
  raw.forEach((item, i) => {
    if (!isRecord(item)) {
      rejected.push(`entry ${i + 1} is not an object`);
      return;
    }
    const def: { language: string; name: string; argv?: string[]; steps?: string[][]; stdin?: string; kind?: RunnerDef["kind"] } = {
      language: typeof item.language === "string" ? item.language.trim() : "",
      name: typeof item.name === "string" ? item.name : "",
    };
    if (item.argv !== undefined) {
      const argv = stringArray(item.argv);
      if (!argv) {
        rejected.push(`entry ${i + 1}: argv is not a list of strings`);
        return;
      }
      def.argv = argv;
    }
    if (item.steps !== undefined) {
      if (!Array.isArray(item.steps) || item.steps.some((s) => stringArray(s) === null)) {
        rejected.push(`entry ${i + 1}: steps is not a list of string lists`);
        return;
      }
      def.steps = item.steps as string[][];
    }
    if (typeof item.stdin === "string") def.stdin = item.stdin;
    if (item.kind === "worker" || item.kind === "process" || item.kind === "page") def.kind = item.kind;
    const problem = validateRunner(def);
    if (problem) {
      rejected.push(`entry ${i + 1}: ${problem}`);
      return;
    }
    runners.push(def);
  });
  return { runners, rejected };
}

/**
 * An argv as one line for the settings row and its edit field: elements with
 * spaces or quotes are double-quoted and `"` inside becomes `\"`; backslashes
 * are left alone, so a Windows path reads as typed. The reverse is
 * `parseArgvLine`. This is display and editing only: the process always gets
 * the array, never this line.
 */
export function formatArgvLine(argv: readonly string[]): string {
  return argv.map((a) => (/[\s"]/.test(a) || a.length === 0 ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
}

/** Steps as one line for the row: the argv lines joined with ` && `; `parseStepsLine` is the reverse. */
export function formatStepsLine(steps: ReadonlyArray<readonly string[]>): string {
  return steps.map((s) => formatArgvLine(s)).join(" && ");
}

/** Split an edited multi-step line at ` && ` (outside quotes) into argv arrays; empty steps are dropped. */
export function parseStepsLine(line: string): string[][] {
  const out: string[][] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? "";
    if (c === '"' && line[i - 1] !== "\\") inQuotes = !inQuotes;
    if (!inQuotes && c === "&" && line[i + 1] === "&") {
      out.push(parseArgvLine(cur));
      cur = "";
      i++;
      continue;
    }
    cur += c;
  }
  out.push(parseArgvLine(cur));
  return out.filter((s) => s.length > 0);
}

/** Split an edited line back into elements: whitespace separates, double quotes group, `\"` is a quote inside quotes; any other backslash is literal. */
export function parseArgvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? "";
    if (inQuotes) {
      if (c === "\\" && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur.length > 0) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (has || cur.length > 0) out.push(cur);
  return out;
}
