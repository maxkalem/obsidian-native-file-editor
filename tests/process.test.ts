import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { DesktopProcessRunner, NodeTempDirs } from "../src/run/process";
import type { RunOutput } from "../src/run/runner";

/**
 * The desktop process runner against the real Node modules, with Node itself
 * as the interpreter: what a run prints, its exit code, the timeout kill, the
 * output cap, a missing program, and stdin.
 */

const runner = () =>
  new DesktopProcessRunner({ child_process, process, fs, os, path } as never, { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout) });

function run(argv: string[], opts: { timeoutMs?: number; cap?: number; stdinText?: string } = {}) {
  const out: RunOutput[] = [];
  const h = runner().start({
    argv,
    cwd: os.tmpdir(),
    stdinText: opts.stdinText,
    timeoutMs: opts.timeoutMs ?? 10_000,
    outputCapBytes: opts.cap ?? 1024 * 1024,
    onOutput: (o) => out.push(o),
  });
  return { h, out, text: (kind: RunOutput["kind"]) => out.filter((o) => o.kind === kind).map((o) => o.text).join("") };
}

describe("DesktopProcessRunner", () => {
  it("streams stdout and stderr and reports the exit code and the wall time", async () => {
    const r = run([process.execPath, "-e", 'process.stdout.write("out\\n"); process.stderr.write("err\\n"); process.exit(3)']);
    const result = await r.h.done;
    expect(r.text("stdout")).toBe("out\n");
    expect(r.text("stderr")).toBe("err\n");
    expect(result).toMatchObject({ exitCode: 3, timedOut: false, stopped: false, truncated: false, error: null });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("runs in the given folder and passes the file path as one argument, spaces and all", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nfe run "));
    const file = path.join(dir, "a b.js");
    fs.writeFileSync(file, 'console.log(process.cwd() === require("path").dirname(__filename) ? "cwd ok" : "cwd " + process.cwd()); console.log(process.argv.slice(2).join("|"))');
    const out: RunOutput[] = [];
    const h = runner().start({ argv: [process.execPath, file, "x y", "z"], cwd: dir, timeoutMs: 10_000, outputCapBytes: 65536, onOutput: (o) => out.push(o) });
    await h.done;
    expect(out.filter((o) => o.kind === "stdout").map((o) => o.text).join("")).toBe("cwd ok\nx y|z\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("kills a program that outlives the timeout and says so", async () => {
    const r = run([process.execPath, "-e", "setInterval(() => {}, 1000)"], { timeoutMs: 300 });
    const result = await r.h.done;
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(r.text("info")).toMatch(/timed out after 300 ms/);
  });

  it("stop kills the program and marks the result stopped", async () => {
    const r = run([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
    setTimeout(() => r.h.stop(), 150);
    const result = await r.h.done;
    expect(result.stopped).toBe(true);
  });

  it("caps output, marks the result truncated and kills the program", async () => {
    const r = run([process.execPath, "-e", 'setInterval(() => process.stdout.write("x".repeat(1000)), 5)'], { cap: 3000, timeoutMs: 5000 });
    const result = await r.h.done;
    expect(result.truncated).toBe(true);
    expect(r.text("stdout").length).toBeLessThanOrEqual(3000);
    expect(r.text("info")).toMatch(/truncated at 3000 bytes/);
  });

  it("a program that does not exist reports the reason instead of throwing", async () => {
    const r = run(["nfe-no-such-interpreter-xyz", "a"]);
    const result = await r.h.done;
    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/nfe-no-such-interpreter-xyz: not found/);
  });

  it("writes stdin text and closes it", async () => {
    const r = run([process.execPath, "-e", 'let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => process.stdout.write("got " + s))'], { stdinText: "hello" });
    await r.h.done;
    expect(r.text("stdout")).toBe("got hello");
  });

  it("temp dirs are created under the OS temp folder and removed", async () => {
    const dirs = new NodeTempDirs({ child_process, process, fs, os, path } as never);
    const p = await dirs.create();
    expect(p.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(p)).toBe(true);
    fs.writeFileSync(path.join(p, "x"), "1");
    await dirs.remove(p);
    expect(fs.existsSync(p)).toBe(false);
  });
});
