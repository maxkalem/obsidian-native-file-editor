import type { Timers } from "../core/autosave";
import type { Logger } from "../core/log";
import type { DeviceLocalStore } from "../settings/DeviceLocalStore";
import type { RunViewDeps } from "../ui/TextView";
import { type ExecuteDeps, execute } from "./execute";
import { DesktopProcessRunner, NodeTempDirs, loadProcessModules } from "./process";
import { runnersFor } from "./runners";
import { BlobWorkerRunner, createBlobWorker } from "./worker";

/**
 * Wires the Run feature for one device (ADR-004). Called from main.ts on the
 * desktop only, once, after the transport exists; returns null when Node is
 * not reachable, and then the feature is absent exactly as on mobile.
 */
export function setupRun(input: {
  readonly isDesktopApp: boolean;
  readonly basePath: string | null;
  readonly device: DeviceLocalStore;
  readonly timers: Timers;
  readonly log: Logger;
  readonly copy?: (text: string) => void;
}): RunViewDeps | null {
  if (!input.isDesktopApp || input.basePath === null) return null;
  let deps: ExecuteDeps;
  let join: (...parts: string[]) => string;
  try {
    const node = loadProcessModules();
    join = (...parts) => node.path.join(...parts);
    deps = {
      processes: new DesktopProcessRunner(node, { setTimeout: (fn, ms) => input.timers.setTimeout(fn, ms), clearTimeout: (id) => input.timers.clearTimeout(id as number) }),
      worker: new BlobWorkerRunner({ createWorker: createBlobWorker, timers: { setTimeout: (fn, ms) => input.timers.setTimeout(fn, ms), clearTimeout: (id) => input.timers.clearTimeout(id as number) } }),
      tempDirs: new NodeTempDirs(node),
    };
  } catch (e) {
    input.log.error("run", "Node is not available; Run is absent on this device", e);
    return null;
  }
  const base = input.basePath;
  return {
    enabled: () => input.device.get().runEnabled,
    runnersFor: (ext) => runnersFor(ext, input.device.get().runners),
    locate: (vaultPath) => {
      const parts = vaultPath.split("/").filter((s) => s.length > 0);
      const name = parts[parts.length - 1] ?? "";
      const dot = name.lastIndexOf(".");
      return {
        file: join(base, ...parts),
        dir: join(base, ...parts.slice(0, -1)),
        stem: dot > 0 ? name.slice(0, dot) : name,
      };
    },
    execute: (req) => {
      const handle = execute(req, deps);
      void handle.done.then((r) => {
        input.log.info(
          "run",
          `${req.def.name} on ${req.file}: ${r.error !== null ? `could not start (${r.error})` : r.stopped ? "stopped" : r.timedOut ? "timed out" : `exit ${r.exitCode}`}${r.steps > 1 ? ` at step ${r.step}/${r.steps}` : ""}, ${r.ms} ms${r.truncated ? ", output truncated" : ""}`
        );
      });
      return handle;
    },
    timeoutMs: () => input.device.get().runTimeoutMs,
    outputCapBytes: () => input.device.get().runOutputCapBytes,
    copy: input.copy,
  };
}
