// rate-table.ts — reference Sonnet per-Mtok rates (config-driven).
// All costs are NOTIONAL — used as fairness/quota units, not real billing.
// Cache-read is priced ~10× cheaper than input (matches Claude's cache pricing).

export interface RateTable {
  /** Cost per million input tokens (USD, NOTIONAL). */
  inputPerMtok: number;
  /** Cost per million output tokens (USD, NOTIONAL). */
  outputPerMtok: number;
  /** Cost per million cache-read tokens (~10× cheaper than input, NOTIONAL). */
  cacheReadPerMtok: number;
  /** Cost per million cache-write tokens (slightly above input, NOTIONAL). */
  cacheWritePerMtok: number;
}

/** Sane Sonnet reference defaults (NOTIONAL, matches Claude public pricing). */
export const DEFAULT_RATE_TABLE: RateTable = {
  inputPerMtok: 3.0,
  outputPerMtok: 15.0,
  cacheReadPerMtok: 0.30,   // ~10× cheaper than input
  cacheWritePerMtok: 3.75,  // slightly above input
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Compute NOTIONAL cost from token counts and a rate table.
 * Result is in USD (NOTIONAL) — a fairness unit, not real billing.
 */
export function computeNotionalCost(tokens: TokenCounts, rates: RateTable = DEFAULT_RATE_TABLE): number {
  const M = 1_000_000;
  return (
    (tokens.inputTokens / M) * rates.inputPerMtok +
    (tokens.outputTokens / M) * rates.outputPerMtok +
    (tokens.cacheReadTokens / M) * rates.cacheReadPerMtok +
    (tokens.cacheWriteTokens / M) * rates.cacheWritePerMtok
  );
}
