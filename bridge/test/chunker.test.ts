// Tests: chunker.ts — size split, code-fence-safe, (i/n) headers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../src/reply/chunker.js";

describe("chunkText", () => {
  it("short text → 1 chunk, no prefix", () => {
    const result = chunkText("Hello world", { maxChars: 3000 });
    assert.equal(result.length, 1);
    assert.equal(result[0], "Hello world");
  });

  it("empty string → 1 chunk", () => {
    const result = chunkText("", { maxChars: 100 });
    assert.equal(result.length, 1);
    assert.equal(result[0], "");
  });

  it("text exactly at cap → 1 chunk, no prefix", () => {
    const text = "a".repeat(100);
    const result = chunkText(text, { maxChars: 100 });
    assert.equal(result.length, 1);
    assert.equal(result[0], text);
  });

  it("long text splits into N chunks with (i/n) prefix", () => {
    // Build text of 3 lines, each 60 chars, cap=100
    const line = "x".repeat(60);
    const text = [line, line, line].join("\n");
    const result = chunkText(text, { maxChars: 100 });
    assert.ok(result.length >= 2, `expected >= 2 chunks, got ${result.length}`);
    const n = result.length;
    result.forEach((chunk, i) => {
      assert.ok(chunk.startsWith(`(${i + 1}/${n})\n`), `chunk ${i} missing prefix: ${chunk.slice(0, 20)}`);
    });
  });

  it("chunks are ordered and contain all lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}: ${"y".repeat(50)}`);
    const text = lines.join("\n");
    const result = chunkText(text, { maxChars: 120 });
    // Reassemble by stripping (i/n) prefix and joining
    const rejoined = result
      .map((c) => c.replace(/^\(\d+\/\d+\)\n/, ""))
      .join("\n");
    assert.equal(rejoined, text);
  });

  it("does NOT split inside a fenced code block", () => {
    // A fence with 5 lines each 60 chars → total ~300 chars inside, cap=100
    const fenceLines = Array.from({ length: 5 }, () => "z".repeat(60));
    const text = ["```typescript", ...fenceLines, "```"].join("\n");
    const result = chunkText(text, { maxChars: 100 });
    // The fence must appear intact in one chunk (not split mid-fence)
    const fenceOpen = result.filter((c) => c.includes("```typescript"));
    const fenceClose = result.filter((c) => {
      // closing ``` should be in the same chunk as opening
      const idx = c.indexOf("```typescript");
      return idx !== -1 && c.indexOf("```", idx + 3) !== -1;
    });
    assert.ok(fenceOpen.length >= 1, "opening fence not found in any chunk");
    assert.ok(
      fenceClose.length >= 1,
      "opening and closing fence should be in the same chunk",
    );
  });

  it("fenced code block lines are kept together — no chunk starts mid-fence", () => {
    const pre = "intro\n";
    const fence = "```\n" + "code line\n".repeat(5) + "```";
    const post = "\nafter";
    const text = pre + fence + post;
    const result = chunkText(text, { maxChars: 50 });

    // Verify no chunk has mismatched fences (odd number of ``` markers)
    for (const chunk of result) {
      const stripped = chunk.replace(/^\(\d+\/\d+\)\n/, "");
      const fenceMarkers = (stripped.match(/^`{3,}/gm) ?? []).length;
      // 0 (no fences) or 2 (open+close) are valid — never 1
      assert.ok(
        fenceMarkers !== 1,
        `chunk has unmatched fence marker: "${stripped.slice(0, 80)}"`,
      );
    }
  });

  it("default maxChars is 3000", () => {
    const text = "a".repeat(2999);
    const result = chunkText(text);
    assert.equal(result.length, 1);
  });

  it("multi-chunk prefix indices are 1-based and correct", () => {
    const line = "m".repeat(80);
    const text = Array.from({ length: 5 }, () => line).join("\n");
    const result = chunkText(text, { maxChars: 100 });
    assert.ok(result.length > 1);
    const n = result.length;
    assert.ok(result[0]!.startsWith(`(1/${n})\n`));
    assert.ok(result[n - 1]!.startsWith(`(${n}/${n})\n`));
  });
});
