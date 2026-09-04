/**
 * Debounced save with one write in flight at a time. The timer functions are
 * injected so a test can drive it without waiting, and the view hands in the
 * window's own timers so a pop-out window keeps working.
 */

export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export class Autosave {
  private timer: number | null = null;
  private dirty = false;
  private inFlight: Promise<void> | null = null;
  private readonly delayMs: number;
  private readonly timers: Timers;
  private readonly save: () => Promise<void>;
  private readonly onError: (e: unknown) => void;

  constructor(opts: { delayMs: number; timers: Timers; save: () => Promise<void>; onError: (e: unknown) => void }) {
    this.delayMs = opts.delayMs;
    this.timers = opts.timers;
    this.save = opts.save;
    this.onError = opts.onError;
  }

  /** Something changed; write after the delay unless another change arrives first. */
  schedule(): void {
    this.dirty = true;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Write now if anything is pending and wait for it. Called when the file is
   * closed or swapped out of the view, so nothing typed is lost.
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
    if (this.dirty) await this.run();
  }

  /** Drop pending work without writing; the view is being torn down after a flush or a discard. */
  cancel(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;
  }

  private async run(): Promise<void> {
    if (this.inFlight) {
      // A write is running; the change it missed is still marked dirty and
      // the next schedule() or flush() picks it up.
      await this.inFlight;
      if (!this.dirty) return;
    }
    this.dirty = false;
    this.inFlight = this.save().catch((e: unknown) => {
      // The text is still in the editor; mark it dirty again so a later
      // flush retries rather than losing it silently.
      this.dirty = true;
      this.onError(e);
    });
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
}
