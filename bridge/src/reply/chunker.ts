// reply/chunker.ts — split long text into Lark-safe chunks.
// Never splits inside an open fenced code block (```).
// Single chunk → no prefix. Multiple chunks → prefix "(i/n)".

export interface ChunkOptions {
  /** Max chars per chunk (default 3000). */
  maxChars?: number;
}

const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * Split `text` into ordered chunks, each ≤ maxChars.
 * Splits on newline boundaries; never mid-code-fence.
 *
 * Strategy: accumulate lines into `current`; only flush when:
 *   - adding the next line would exceed cap, AND
 *   - we are NOT inside a fence (inFence=false before AND after processing the line).
 *
 * A fence may cause `current` to exceed `cap` — that is intentional:
 * code-block integrity takes priority over the size limit.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const cap = opts.maxChars ?? 3000;

  if (text.length <= cap) return [text];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  let inFence = false;

  for (const line of lines) {
    const isFenceMarker = FENCE_RE.test(line);
    // Determine fence state BEFORE adding this line
    const wasInFence = inFence;
    if (isFenceMarker) inFence = !inFence;
    // After toggle: inFence is true if we just opened, false if we just closed.
    const nowInFence = inFence;

    const candidate = current ? `${current}\n${line}` : line;

    // Flush only when:
    //   - candidate would exceed cap
    //   - we have something in current (don't flush empty)
    //   - we were NOT inside a fence before this line (wasInFence=false)
    //   - this line is NOT closing a fence (isFenceMarker && !nowInFence)
    //     (the closing ``` must stay with its block)
    const canFlush = !wasInFence && !(isFenceMarker && !nowInFence);

    if (canFlush && candidate.length > cap && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);

  // Single chunk edge case (e.g. giant fence kept together)
  if (chunks.length === 1) return chunks;

  // Prefix multi-part chunks with (i/n)
  const n = chunks.length;
  return chunks.map((c, i) => `(${i + 1}/${n})\n${c}`);
}
