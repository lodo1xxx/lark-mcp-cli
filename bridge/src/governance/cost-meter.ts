// cost-meter.ts — price a RunResult into a NOTIONAL cost (USD, fairness unit).
// Primary source: RunResult.notionalCostUsd (Claude's total_cost_usd — cache-aware, accurate).
// Fallback: compute from rate-table when total_cost_usd is absent or zero.
// All values labeled NOTIONAL — not real billing.

import type { RunResult } from "../engine/engine-types.js";
import { computeNotionalCost, DEFAULT_RATE_TABLE, type RateTable } from "./rate-table.js";

export interface PricedRun {
  /** NOTIONAL cost in USD — primary=total_cost_usd, fallback=rate-table. */
  notionalCostUsd: number;
  /** Indicates which source was used. */
  source: "claude_provided" | "rate_table";
}

/**
 * Price a completed run.
 * Prefers Claude's total_cost_usd (already cache-aware and accurate).
 * Falls back to rate-table computation when total_cost_usd is absent or zero.
 */
export function priceRun(result: RunResult, rateTable: RateTable = DEFAULT_RATE_TABLE): PricedRun {
  if (result.notionalCostUsd > 0) {
    return { notionalCostUsd: result.notionalCostUsd, source: "claude_provided" };
  }

  const computed = computeNotionalCost(result.usage, rateTable);
  return { notionalCostUsd: computed, source: "rate_table" };
}
