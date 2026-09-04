import { describe, expect, it } from "vitest";
import { Autosave, type Timers } from "../src/core/autosave";

/** Deterministic timers: the test decides when the delay elapses. */
class FakeTimers implements Timers {
  private next = 1;
  pending = new Map<number, () => void>();
  setTimeout(fn: () => void, _ms: number): number {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  }
  clearTimeout(id: number): void {
    this.pending.delete(id);
  }
  fireAll(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn();
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("Autosave", () => {
  it("writes once after the delay, however many changes arrived", async () => {
    const timers = new FakeTimers();
    let saves = 0;
    const a = new Autosave({ delayMs: 10, timers, save: async () => void saves++, onError: () => undefined });
    a.schedule();
    a.schedule();
    a.schedule();
    expect(timers.pending.size).toBe(1);
    expect(a.isDirty).toBe(true);
    timers.fireAll();
    await tick();
    expect(saves).toBe(1);
    expect(a.isDirty).toBe(false);
  });

  it("flush writes pending changes immediately and waits for them", async () => {
    const timers = new FakeTimers();
    const order: string[] = [];
    const a = new Autosave({
      delayMs: 10,
      timers,
      save: async () => {
        order.push("save-start");
        await tick();
        order.push("save-end");
      },
      onError: () => undefined,
    });
    a.schedule();
    await a.flush();
    order.push("flushed");
    expect(order).toEqual(["save-start", "save-end", "flushed"]);
    expect(timers.pending.size).toBe(0);
  });

  it("flush with nothing pending writes nothing", async () => {
    let saves = 0;
    const a = new Autosave({ delayMs: 10, timers: new FakeTimers(), save: async () => void saves++, onError: () => undefined });
    await a.flush();
    expect(saves).toBe(0);
  });

  it("a change during a write is written by the next flush, not lost", async () => {
    const timers = new FakeTimers();
    let release: () => void = () => undefined;
    const saved: number[] = [];
    let counter = 0;
    const a = new Autosave({
      delayMs: 10,
      timers,
      save: () =>
        new Promise<void>((r) => {
          saved.push(counter);
          // The first write is held open by the test; later ones finish at once.
          if (saved.length === 1) release = r;
          else r();
        }),
      onError: () => undefined,
    });
    counter = 1;
    a.schedule();
    timers.fireAll();
    await tick();
    expect(saved).toEqual([1]);
    counter = 2;
    a.schedule();
    release();
    await a.flush();
    expect(saved).toEqual([1, 2]);
  });

  it("a failed write reports the error and stays dirty for a retry", async () => {
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    let fail = true;
    let saves = 0;
    const a = new Autosave({
      delayMs: 10,
      timers,
      save: async () => {
        saves++;
        if (fail) throw new Error("disk full");
      },
      onError: (e) => errors.push(e),
    });
    a.schedule();
    timers.fireAll();
    await tick();
    expect(errors).toHaveLength(1);
    expect(a.isDirty).toBe(true);
    fail = false;
    await a.flush();
    expect(saves).toBe(2);
    expect(a.isDirty).toBe(false);
  });

  it("cancel drops pending work without writing", async () => {
    const timers = new FakeTimers();
    let saves = 0;
    const a = new Autosave({ delayMs: 10, timers, save: async () => void saves++, onError: () => undefined });
    a.schedule();
    a.cancel();
    timers.fireAll();
    await a.flush();
    expect(saves).toBe(0);
  });
});
