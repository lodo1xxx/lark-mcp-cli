// Tests: ndjson-reader.ts — partial lines, multi-line flush, parse errors, end flush.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createNdjsonReader } from "../src/ingest/ndjson-reader.js";

function makeReadable(): { stream: Readable; push: (s: string) => void; end: () => void } {
  const stream = new Readable({ read() {} });
  stream.setEncoding("utf-8");
  return {
    stream,
    push: (s: string) => stream.push(s),
    end: () => stream.push(null),
  };
}

async function collect(
  setup: (push: (s: string) => void, end: () => void) => void,
): Promise<{ data: unknown[]; errors: Error[] }> {
  const { stream, push, end } = makeReadable();
  const reader = createNdjsonReader(stream);
  const data: unknown[] = [];
  const errors: Error[] = [];

  reader.on("data", (obj) => data.push(obj));
  reader.on("error", (err) => errors.push(err));

  setup(push, end);

  // Wait for stream to finish
  await new Promise<void>((resolve) => stream.once("end", resolve));
  // Small tick to let flush complete
  await new Promise<void>((r) => setImmediate(r));

  return { data, errors };
}

describe("createNdjsonReader", () => {
  it("parses a single complete line", async () => {
    const { data } = await collect((push, end) => {
      push('{"type":"ping"}\n');
      end();
    });
    assert.equal(data.length, 1);
    assert.deepEqual(data[0], { type: "ping" });
  });

  it("parses multiple complete lines in one chunk", async () => {
    const { data } = await collect((push, end) => {
      push('{"a":1}\n{"b":2}\n{"c":3}\n');
      end();
    });
    assert.equal(data.length, 3);
    assert.deepEqual(data[0], { a: 1 });
    assert.deepEqual(data[1], { b: 2 });
    assert.deepEqual(data[2], { c: 3 });
  });

  it("handles partial lines split across chunks", async () => {
    const { data } = await collect((push, end) => {
      push('{"typ');
      push('e":"hello"}\n');
      end();
    });
    assert.equal(data.length, 1);
    assert.deepEqual(data[0], { type: "hello" });
  });

  it("flushes trailing content without newline on stream end", async () => {
    const { data } = await collect((push, end) => {
      push('{"flushed":true}');
      end();
    });
    assert.equal(data.length, 1);
    assert.deepEqual(data[0], { flushed: true });
  });

  it("emits error for malformed JSON line but continues", async () => {
    const { data, errors } = await collect((push, end) => {
      push("not-json\n");
      push('{"ok":1}\n');
      end();
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0]!.message.includes("NDJSON parse error"));
    assert.equal(data.length, 1);
    assert.deepEqual(data[0], { ok: 1 });
  });

  it("skips blank lines silently", async () => {
    const { data, errors } = await collect((push, end) => {
      push('{"x":1}\n\n\n{"y":2}\n');
      end();
    });
    assert.equal(data.length, 2);
    assert.equal(errors.length, 0);
  });

  it("handles empty stream gracefully", async () => {
    const { data, errors } = await collect((_push, end) => {
      end();
    });
    assert.equal(data.length, 0);
    assert.equal(errors.length, 0);
  });

  it("multiple chunks arriving in sequence are assembled correctly", async () => {
    const { data } = await collect((push, end) => {
      // 5 objects, each split mid-key
      for (let i = 0; i < 5; i++) {
        push(`{"i":${i}`);
        push("}\n");
      }
      end();
    });
    assert.equal(data.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(data[i], { i });
    }
  });
});
