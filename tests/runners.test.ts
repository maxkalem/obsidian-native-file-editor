import { describe, expect, it } from "vitest";
import { type ExecuteDeps, type ExecuteRequest, execute, precheck } from "../src/run/execute";
import { OutputCap, type ProcessRequest, type ProcessRunner, type RunHandle, type RunOutput, type RunResult, type TempDirs, type WorkerRunner } from "../src/run/runner";
import {
  DEFAULT_RUNNERS,
  type RunnerDef,
  expandArgv,
  formatArgvLine,
  normalizeRunners,
  parseArgvLine,
  refusePath,
  runnerLanguageExists,
  runnersFor,
  stepsOf,
  validateRunner,
} from "../src/run/runners";

/**
 * The pure half of Run (ADR-004): definitions, placeholder expansion, what is
 * refused before anything starts, the output cap, and the executor's
 * orchestration of steps against fake runners. No process is started here;
 * process.test.ts does that with the real Node.
 */

const ctx = { file: "/v/notes/app.py", dir: "/v/notes", stem: "app", tmp: "/tmp/nfe-run-x" };

describe("runner definitions", () => {
  it("every default is valid, names a language the registry knows, and calls a bare command or a placeholder-built path", () => {
    for (const def of DEFAULT_RUNNERS) {
      expect(validateRunner(def), def.name).toBeNull();
      expect(runnerLanguageExists(def), def.language).toBe(true);
      for (const step of stepsOf(def)) {
        const command = step[0] ?? "";
        expect(!/[\\/]/.test(command) || command.startsWith("{tmp}"), `${def.name}: ${command}`).toBe(true);
      }
    }
    // Runners are found through the file's LANGUAGE, so every extension of it shares them.
    expect(runnersFor("JS", DEFAULT_RUNNERS).map((r) => r.name)).toEqual(["Sandbox (Web Worker)", "Node"]);
    expect(runnersFor("mjs", DEFAULT_RUNNERS).map((r) => r.name)).toEqual(["Sandbox (Web Worker)", "Node"]);
    expect(runnersFor("pyw", DEFAULT_RUNNERS).map((r) => r.name)).toEqual(["Python"]);
    expect(runnersFor("htm", DEFAULT_RUNNERS).map((r) => r.kind)).toEqual(["open"]);
    expect(runnersFor("mht", DEFAULT_RUNNERS).map((r) => r.kind)).toEqual(["open"]);
    expect(runnersFor("xyz", DEFAULT_RUNNERS)).toEqual([]);
    expect(runnersFor("txt", DEFAULT_RUNNERS)).toEqual([]);
  });

  it("expands placeholders inside an element and never splits or joins elements", () => {
    expect(expandArgv(["python", "{file}"], ctx)).toEqual(["python", "/v/notes/app.py"]);
    expect(expandArgv(["rustc", "{file}", "-o", "{tmp}/{stem}"], ctx)).toEqual(["rustc", "/v/notes/app.py", "-o", "/tmp/nfe-run-x/app"]);
    expect(expandArgv(["{tmp}/{stem}.jar"], ctx)).toEqual(["/tmp/nfe-run-x/app.jar"]);
    expect(expandArgv(["echo", "{file} {dir}"], { ...ctx, file: "a b", dir: "c" })).toEqual(["echo", "a b c"]);
  });

  it("refuses paths that could escape an argument", () => {
    expect(refusePath("/v/a b/c.py")).toBeNull();
    expect(refusePath("/v/a\nb.py")).toMatch(/line break/);
    expect(refusePath("/v/a\0b.py")).toMatch(/NUL/);
  });

  it("validates a definition", () => {
    expect(validateRunner({ language: "Python", name: "P", argv: ["python", "{file}"] })).toBeNull();
    expect(validateRunner({ language: "Python", name: "P" })).toMatch(/neither argv nor steps/);
    expect(validateRunner({ language: "Python", name: "", argv: ["python"] })).toMatch(/no name/);
    expect(validateRunner({ language: "", name: "P", argv: ["python"] })).toMatch(/no language/);
    expect(validateRunner({ language: "Python", name: "P", argv: [] })).toMatch(/empty step/);
    expect(validateRunner({ language: "Python", name: "P", argv: ["python", ""] })).toMatch(/empty argument/);
    expect(validateRunner({ language: "Python", name: "P", argv: ["{file}"] })).toMatch(/file as the command/);
    expect(validateRunner({ language: "JavaScript", name: "W", kind: "worker" })).toBeNull();
    expect(validateRunner({ language: "HTML", name: "O", kind: "open" })).toBeNull();
    expect(validateRunner({ language: "JavaScript", name: "W", kind: "worker", argv: ["node"] })).toMatch(/must not have argv/);
    expect(validateRunner({ language: "SQL", name: "S", argv: ["sqlite3"], stdin: "" })).toMatch(/empty stdin/);
  });

  it("normalizes a list from storage, dropping and naming bad entries", () => {
    expect(normalizeRunners("nope")).toBeNull();
    expect(normalizeRunners({})).toBeNull();
    const r = normalizeRunners([
      { language: " Python ", name: "Python", argv: ["python3", "{file}"] },
      { language: "Rust", name: "Rust", steps: [["rustc", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}"]] },
      { language: "JavaScript", name: "Sandbox", kind: "worker" },
      { language: "Lua", name: "Lua", argv: "lua {file}" },
      { language: "X", name: "X", steps: [["ok"], "bad"] },
      "text",
      { language: "Y", name: "Y" },
    ]);
    expect(r?.runners).toEqual([
      { language: "Python", name: "Python", argv: ["python3", "{file}"] },
      { language: "Rust", name: "Rust", steps: [["rustc", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}"]] },
      { language: "JavaScript", name: "Sandbox", kind: "worker" },
    ]);
    expect(r?.rejected).toEqual([
      "entry 4: argv is not a list of strings",
      "entry 5: steps is not a list of string lists",
      "entry 6 is not an object",
      'entry 7: runner "Y" has neither argv nor steps',
    ]);
    // The stored defaults round-trip.
    expect(normalizeRunners(JSON.parse(JSON.stringify(DEFAULT_RUNNERS)))?.runners).toEqual(DEFAULT_RUNNERS);
  });

  it("the argv line for the settings field quotes what needs it and parses back exactly", () => {
    const argv = ["C:\\Program Files\\Python\\python.exe", "-u", "{file}", 'say "hi"', ""];
    const line = formatArgvLine(argv);
    expect(line).toBe('"C:\\Program Files\\Python\\python.exe" -u {file} "say \\"hi\\"" ""');
    expect(parseArgvLine(line)).toEqual(argv);
    expect(parseArgvLine("  python   {file}  ")).toEqual(["python", "{file}"]);
    expect(parseArgvLine("")).toEqual([]);
  });
});

describe("OutputCap", () => {
  it("passes text until the cap, cuts the last chunk on a character boundary, then passes nothing", () => {
    const cap = new OutputCap(5);
    expect(cap.admit("ab")).toBe("ab");
    expect(cap.admit("cdefg")).toBe("cde");
    expect(cap.truncated).toBe(true);
    expect(cap.admit("x")).toBeNull();
  });
  it("counts UTF-8 bytes, not characters", () => {
    const cap = new OutputCap(4);
    expect(cap.admit("éé")).toBe("éé");
    expect(cap.admit("é")).toBe("");
    const cap2 = new OutputCap(3);
    expect(cap2.admit("éé")).toBe("é");
  });
});

/** A process runner that replays a script per command. */
class FakeProcesses implements ProcessRunner {
  requests: ProcessRequest[] = [];
  stopped = 0;
  /** command -> what it prints and returns. */
  script = new Map<string, { out?: string; err?: string; exit: number; error?: string; hang?: boolean }>();
  start(req: ProcessRequest): RunHandle {
    this.requests.push(req);
    const s = this.script.get(req.argv[0] ?? "") ?? { exit: 0 };
    let resolve!: (r: RunResult) => void;
    const done = new Promise<RunResult>((r) => (resolve = r));
    const finish = (stopped: boolean) => resolve({ exitCode: s.error ? null : stopped ? null : s.exit, timedOut: false, stopped, truncated: false, ms: 5, error: s.error ?? null });
    if (s.out) req.onOutput({ kind: "stdout", text: s.out });
    if (s.err) req.onOutput({ kind: "stderr", text: s.err });
    if (!s.hang) queueMicrotask(() => finish(false));
    return {
      stop: () => {
        this.stopped++;
        finish(true);
      },
      done,
    };
  }
}

class FakeWorker implements WorkerRunner {
  codes: string[] = [];
  start(req: { code: string; onOutput: (o: RunOutput) => void }): RunHandle {
    this.codes.push(req.code);
    req.onOutput({ kind: "stdout", text: "hi\n" });
    return { stop: () => undefined, done: Promise.resolve({ exitCode: 0, timedOut: false, stopped: false, truncated: false, ms: 1, error: null }) };
  }
}

class FakeTemp implements TempDirs {
  created: string[] = [];
  removed: string[] = [];
  async create(): Promise<string> {
    const p = `/tmp/nfe-run-${this.created.length}`;
    this.created.push(p);
    return p;
  }
  async remove(p: string): Promise<void> {
    this.removed.push(p);
  }
}

function request(def: RunnerDef, onOutput: (o: RunOutput) => void = () => undefined): ExecuteRequest {
  return { def, file: "/v/notes/app.py", dir: "/v/notes", stem: "app", text: "print(1)\n", timeoutMs: 1000, outputCapBytes: 4096, onOutput };
}

describe("execute", () => {
  it("runs one process in the file's folder with the expanded argv and announces it", async () => {
    const processes = new FakeProcesses();
    processes.script.set("python", { out: "1\n", exit: 0 });
    const out: RunOutput[] = [];
    const r = await execute(request({ language: "Python", name: "Python", argv: ["python", "{file}"] }, (o) => out.push(o)), { processes, worker: new FakeWorker(), tempDirs: new FakeTemp(), openPath: null }).done;
    expect(processes.requests[0]).toMatchObject({ argv: ["python", "/v/notes/app.py"], cwd: "/v/notes", stdinText: undefined, timeoutMs: 1000, outputCapBytes: 4096 });
    expect(out).toEqual([
      { kind: "info", text: "[Python] python /v/notes/app.py\n" },
      { kind: "stdout", text: "1\n" },
    ]);
    expect(r).toMatchObject({ exitCode: 0, step: 1, steps: 1, error: null });
  });

  it("steps run in order in a temp dir that is removed; a failing step ends the run", async () => {
    const processes = new FakeProcesses();
    processes.script.set("rustc", { err: "error[E0425]\n", exit: 1 });
    const temp = new FakeTemp();
    const def: RunnerDef = { language: "Rust", name: "rustc + run", steps: [["rustc", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}"]] };
    const r = await execute(request(def), { processes, worker: new FakeWorker(), tempDirs: temp, openPath: null }).done;
    expect(processes.requests.map((q) => q.argv)).toEqual([["rustc", "/v/notes/app.py", "-o", "/tmp/nfe-run-0/app"]]);
    expect(r).toMatchObject({ exitCode: 1, step: 1, steps: 2 });
    expect(temp.removed).toEqual(["/tmp/nfe-run-0"]);
    // Success runs both, the second step being the compiled program.
    processes.script.set("rustc", { exit: 0 });
    processes.script.set("/tmp/nfe-run-1/app", { out: "ok\n", exit: 0 });
    const r2 = await execute(request(def), { processes, worker: new FakeWorker(), tempDirs: temp, openPath: null }).done;
    expect(processes.requests.slice(1).map((q) => q.argv)).toEqual([["rustc", "/v/notes/app.py", "-o", "/tmp/nfe-run-1/app"], ["/tmp/nfe-run-1/app"]]);
    expect(r2).toMatchObject({ exitCode: 0, step: 2, steps: 2 });
    expect(temp.removed).toEqual(["/tmp/nfe-run-0", "/tmp/nfe-run-1"]);
  });

  it("feeds the document to stdin when the runner says so, on the last step only", async () => {
    const processes = new FakeProcesses();
    await execute(request({ language: "SQL", name: "sqlite3", argv: ["sqlite3", ":memory:"], stdin: "{file}" }), { processes, worker: new FakeWorker(), tempDirs: null, openPath: null }).done;
    expect(processes.requests[0]?.stdinText).toBe("print(1)\n");
  });

  it("stop kills the current step and ends the run as stopped", async () => {
    const processes = new FakeProcesses();
    processes.script.set("python", { hang: true, exit: 0 });
    const h = execute(request({ language: "Python", name: "Python", argv: ["python", "{file}"] }), { processes, worker: new FakeWorker(), tempDirs: null, openPath: null });
    await Promise.resolve();
    h.stop();
    const r = await h.done;
    expect(processes.stopped).toBe(1);
    expect(r.stopped).toBe(true);
  });

  it("a worker runner gets the document text and no process", async () => {
    const processes = new FakeProcesses();
    const worker = new FakeWorker();
    const out: RunOutput[] = [];
    const r = await execute(request({ language: "JavaScript", name: "Sandbox (Web Worker)", kind: "worker" }, (o) => out.push(o)), { processes, worker, tempDirs: null, openPath: null }).done;
    expect(worker.codes).toEqual(["print(1)\n"]);
    expect(processes.requests).toEqual([]);
    expect(out[0]).toEqual({ kind: "info", text: "[Sandbox (Web Worker)]\n" });
    expect(r).toMatchObject({ exitCode: 0, step: 1, steps: 1 });
  });

  it("refuses before starting: no process runner (mobile), a bad path, a temp dir it does not have, an invalid definition", async () => {
    const deps: ExecuteDeps = { processes: null, worker: new FakeWorker(), tempDirs: null, openPath: null };
    expect(precheck(request({ language: "Python", name: "P", argv: ["python", "{file}"] }), deps)).toMatch(/desktop/);
    expect(precheck(request({ language: "JavaScript", name: "W", kind: "worker" }), deps)).toBeNull();
    const withProcesses: ExecuteDeps = { processes: new FakeProcesses(), worker: new FakeWorker(), tempDirs: null, openPath: null };
    expect(precheck({ ...request({ language: "Python", name: "P", argv: ["python", "{file}"] }), file: "/v/a\nb" }, withProcesses)).toMatch(/line break/);
    expect(precheck(request({ language: "Rust", name: "R", steps: [["rustc", "{file}", "-o", "{tmp}/x"], ["{tmp}/x"]] }), withProcesses)).toMatch(/temp directory/);
    expect(precheck(request({ language: "Python", name: "P" }), withProcesses)).toMatch(/neither argv/);
    const r = await execute(request({ language: "Python", name: "P", argv: ["python", "{file}"] }), deps).done;
    expect(r).toMatchObject({ exitCode: null, error: expect.stringMatching(/desktop/), step: 0, steps: 0 });
  });

  it("a process that could not start reports the reason", async () => {
    const processes = new FakeProcesses();
    processes.script.set("python", { exit: 0, error: "python: not found" });
    const r = await execute(request({ language: "Python", name: "P", argv: ["python", "{file}"] }), { processes, worker: new FakeWorker(), tempDirs: null, openPath: null }).done;
    expect(r.error).toBe("python: not found");
    expect(r.exitCode).toBeNull();
  });
});
