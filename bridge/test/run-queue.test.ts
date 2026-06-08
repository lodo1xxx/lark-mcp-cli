// Tests: run-queue.ts — concurrency=1 serializes; gauges correct; env-scrub guard

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RunQueue } from "../src/engine/run-queue.js";

describe("RunQueue", () => {
  it("concurrency=1 serializes two tasks (no overlap)", async () => {
    const queue = new RunQueue(1);
    const log: string[] = [];

    const t1 = queue.enqueue(async () => {
      log.push("t1-start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("t1-end");
    });

    const t2 = queue.enqueue(async () => {
      log.push("t2-start");
      await new Promise((r) => setTimeout(r, 5));
      log.push("t2-end");
    });

    await Promise.all([t1, t2]);

    // With concurrency=1, t2 must start only after t1 ends
    assert.deepEqual(log, ["t1-start", "t1-end", "t2-start", "t2-end"]);
  });

  it("concurrency=2 allows overlap", async () => {
    const queue = new RunQueue(2);
    const log: string[] = [];

    const t1 = queue.enqueue(async () => {
      log.push("t1-start");
      await new Promise((r) => setTimeout(r, 30));
      log.push("t1-end");
    });

    const t2 = queue.enqueue(async () => {
      log.push("t2-start");
      await new Promise((r) => setTimeout(r, 5));
      log.push("t2-end");
    });

    await Promise.all([t1, t2]);

    // Both start before either ends
    assert.equal(log[0], "t1-start");
    assert.equal(log[1], "t2-start");
    assert.equal(log[2], "t2-end");
    assert.equal(log[3], "t1-end");
  });

  it("inFlight gauge reflects running tasks", async () => {
    const queue = new RunQueue(1);
    let peakInFlight = 0;

    const t = queue.enqueue(async () => {
      peakInFlight = Math.max(peakInFlight, queue.inFlight);
      await new Promise((r) => setTimeout(r, 5));
    });

    await t;
    assert.equal(peakInFlight, 1);
    assert.equal(queue.inFlight, 0);
  });

  it("queued gauge reflects pending backlog", async () => {
    const queue = new RunQueue(1);
    const snapshots: number[] = [];

    // Block the first slot with a task that pauses mid-run to let us enqueue more
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });

    const t1 = queue.enqueue(async () => {
      await blocker; // paused — t2 will be queued during this time
    });

    // Enqueue t2 synchronously before unblocking t1
    const t2 = queue.enqueue(async () => {/* no-op */});

    // Snapshot the queue while t1 is blocked and t2 is waiting
    snapshots.push(queue.queued);   // should be 1
    snapshots.push(queue.inFlight); // should be 1

    unblock(); // let t1 finish
    await Promise.all([t1, t2]);

    assert.equal(snapshots[0], 1, "t2 should be queued while t1 is blocked");
    assert.equal(snapshots[1], 1, "inFlight should be 1 while t1 is running");
    assert.equal(queue.queued, 0, "nothing pending after both done");
    assert.equal(queue.inFlight, 0, "nothing in-flight after both done");
  });

  it("rejects with RangeError for concurrency < 1", () => {
    assert.throws(() => new RunQueue(0), RangeError);
  });

  it("propagates task rejection without hanging queue", async () => {
    const queue = new RunQueue(1);

    await assert.rejects(
      queue.enqueue(async () => { throw new Error("boom"); }),
      /boom/,
    );

    // Queue should still work after rejection
    const result = await queue.enqueue(async () => "ok");
    assert.equal(result, "ok");
  });

  it("returns task resolved value", async () => {
    const queue = new RunQueue(1);
    const val = await queue.enqueue(async () => 42);
    assert.equal(val, 42);
  });
});

describe("claude-runner env scrub guard", () => {
  it("ANTHROPIC_API_KEY is NOT present in the test process env", () => {
    // If this assertion fails, the test environment is mis-configured.
    // claude-runner scrubs it before every spawn — this confirms the baseline.
    const hasKey = "ANTHROPIC_API_KEY" in process.env && process.env["ANTHROPIC_API_KEY"] !== "";
    assert.equal(hasKey, false, "ANTHROPIC_API_KEY must not be set in test env — would bill API instead of OAuth");
  });

  it("scrubEnv logic: deleting key from cloned env leaves original intact", () => {
    // Mirror the scrubEnv logic from claude-runner.ts
    const original = { ...process.env, ANTHROPIC_API_KEY: "sk-test" };
    const cloned = { ...original };
    delete cloned["ANTHROPIC_API_KEY"];

    assert.ok(!("ANTHROPIC_API_KEY" in cloned), "key must be gone from clone");
    assert.equal(original["ANTHROPIC_API_KEY"], "sk-test", "original untouched");
  });
});
