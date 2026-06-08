// Tests: output-parser.ts — confirmed envelope fixture + error cases

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope } from "../src/engine/output-parser.js";
import { EngineError } from "../src/engine/engine-types.js";

// Confirmed live envelope (sampled 2026-06-08 on this machine)
const SUCCESS_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "OK",
  session_id: "31a84340-a74d-46e6-9234-1eb0c12984b6",
  total_cost_usd: 0.2735875,
  num_turns: 1,
  duration_ms: 4850,
  stop_reason: "end_turn",
  permission_denials: [],
  usage: {
    input_tokens: 14729,
    output_tokens: 4,
    cache_creation_input_tokens: 30961,
    cache_read_input_tokens: 0,
    service_tier: "standard",
  },
  modelUsage: {},
});

const ERROR_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  result: "Something went wrong",
  session_id: "aaa-bbb",
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

describe("parseEnvelope", () => {
  it("extracts text from result field", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.text, "OK");
  });

  it("extracts sessionId", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.sessionId, "31a84340-a74d-46e6-9234-1eb0c12984b6");
  });

  it("extracts notional cost", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.notionalCostUsd, 0.2735875);
  });

  it("extracts token usage — inputTokens", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.usage.inputTokens, 14729);
  });

  it("extracts token usage — outputTokens", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.usage.outputTokens, 4);
  });

  it("extracts token usage — cacheReadTokens", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.usage.cacheReadTokens, 0);
  });

  it("extracts token usage — cacheWriteTokens (cache_creation_input_tokens)", () => {
    const r = parseEnvelope(SUCCESS_ENVELOPE);
    assert.equal(r.usage.cacheWriteTokens, 30961);
  });

  it("throws BAD_OUTPUT for is_error:true envelope", () => {
    assert.throws(
      () => parseEnvelope(ERROR_ENVELOPE),
      (err: unknown) => {
        assert.ok(err instanceof EngineError);
        assert.equal(err.code, "BAD_OUTPUT");
        return true;
      },
    );
  });

  it("throws BAD_OUTPUT for non-success subtype", () => {
    const env = JSON.stringify({ type: "result", subtype: "other", is_error: false, result: "x", session_id: "s" });
    assert.throws(
      () => parseEnvelope(env),
      (err: unknown) => err instanceof EngineError && err.code === "BAD_OUTPUT",
    );
  });

  it("throws BAD_OUTPUT for unparseable output", () => {
    assert.throws(
      () => parseEnvelope("not json at all"),
      (err: unknown) => err instanceof EngineError && err.code === "BAD_OUTPUT",
    );
  });

  it("tolerates leading/trailing whitespace", () => {
    const r = parseEnvelope(`   \n${SUCCESS_ENVELOPE}\n   `);
    assert.equal(r.text, "OK");
  });

  it("uses last JSON object when multiple lines present", () => {
    const noise = '{"type":"stream","text":"partial"}\n';
    const r = parseEnvelope(noise + SUCCESS_ENVELOPE);
    assert.equal(r.text, "OK");
  });
});
