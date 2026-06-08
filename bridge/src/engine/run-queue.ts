// run-queue.ts — hand-rolled bounded-concurrency queue.
// Concurrency from config (default 1 = serial). No external deps.
// Exposes inFlight and queued gauges as getters.

type Task<T> = () => Promise<T>;

interface QueueEntry {
  fn: Task<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export class RunQueue {
  private readonly concurrency: number;
  private _inFlight = 0;
  private readonly pending: QueueEntry[] = [];

  constructor(concurrency = 1) {
    if (concurrency < 1) throw new RangeError("concurrency must be >= 1");
    this.concurrency = concurrency;
  }

  get inFlight(): number {
    return this._inFlight;
  }

  get queued(): number {
    return this.pending.length;
  }

  enqueue<T>(fn: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ fn: fn as Task<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this._inFlight < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      this._inFlight++;
      entry.fn().then(
        (val) => { this._inFlight--; entry.resolve(val); this.drain(); },
        (err) => { this._inFlight--; entry.reject(err); this.drain(); },
      );
    }
  }
}
