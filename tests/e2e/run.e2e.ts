import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { workerSource } from "../../src/run/worker";

/**
 * The JavaScript sample (fixtures/code/sample.js) has to run in the plugin's
 * sandbox, or the Run button has nothing to show. The prelude needs a Worker
 * global; a `vm` context with `self`, `postMessage` and timers stands in for
 * one, which is enough to prove the script is not a module, sets no network
 * up, and finishes on its own.
 */

const SAMPLE = fileURLToPath(new URL("./fixtures/code/sample.js", import.meta.url));

function runInFakeWorker(code: string): Promise<Array<{ type: string; level?: string; text?: string }>> {
  return new Promise((resolve, reject) => {
    const messages: Array<{ type: string; level?: string; text?: string }> = [];
    const sandbox: Record<string, unknown> = {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
      addEventListener() {},
    };
    sandbox.self = sandbox;
    sandbox.postMessage = (m: { type: string; level?: string; text?: string }) => {
      messages.push(m);
      if (m.type === "done") resolve(messages);
    };
    const timer = setTimeout(() => reject(new Error(`no done message; got ${JSON.stringify(messages)}`)), 5000);
    try {
      vm.runInNewContext(workerSource(code), vm.createContext(sandbox));
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

describe("the JavaScript sample under Run", () => {
  it("is a plain script that the worker prelude can run to completion, with its console output", async () => {
    const code = fs.readFileSync(SAMPLE, "utf8");
    expect(code).not.toMatch(/^\s*(import|export)\b/m);
    const messages = await runInFakeWorker(code);
    const logs = messages.filter((m) => m.type === "log").map((m) => `${m.level}:${m.text?.trimEnd()}`);
    expect(logs).toEqual(['log:a.md: 2 tags ["obsidian","code-editors"]', "log:large: false", "error:stderr goes red"]);
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(messages.at(-1)?.type).toBe("done");
  });
});
