// NDJSON reader: buffers stdout chunks from lark-cli and emits one parsed
// object per complete line. Handles partial lines across chunk boundaries.

import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

export interface NdjsonReader extends EventEmitter {
  on(event: "data", listener: (obj: unknown) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Attach an NDJSON reader to a readable stream.
 * Emits "data" for each valid JSON line; emits "error" on parse failure
 * (but continues processing — malformed lines are skipped gracefully).
 */
export function createNdjsonReader(source: Readable): NdjsonReader {
  const emitter = new EventEmitter() as NdjsonReader;
  let buffer = "";

  source.setEncoding("utf-8");

  source.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    // Keep the last (possibly incomplete) segment in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as unknown;
        emitter.emit("data", obj);
      } catch {
        emitter.emit("error", new Error(`NDJSON parse error: ${trimmed.slice(0, 120)}`));
      }
    }
  });

  source.on("end", () => {
    // Flush any remaining content
    const trimmed = buffer.trim();
    buffer = "";
    if (trimmed) {
      try {
        emitter.emit("data", JSON.parse(trimmed) as unknown);
      } catch {
        // discard incomplete trailing line silently
      }
    }
  });

  source.on("error", (err: Error) => {
    emitter.emit("error", err);
  });

  return emitter;
}
