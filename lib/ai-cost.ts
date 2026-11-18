// Official USD / 1M-token rates checked 2026-11-17. Estimates, not an account balance.
export function estimateAiCost(rows: { model: string; prompt_tokens: number; completion_tokens: number; cached_tokens: number }[]) {
  let low = 0, high = 0;
  for (const row of rows) {
    const rate = row.model === "deepseek-flash" ? [0.006, 0.3, 1.2] : row.model === "deepseek-v4-pro" ? [0.044, 1.32, 3.96] : null;
    if (!rate) return null;
    const cached = Math.min(row.prompt_tokens, row.cached_tokens), missed = row.prompt_tokens-cached;
    const cost = (cached*rate[0]+missed*rate[1]+row.completion_tokens*rate[2])/1_000_000;
    high += cost; low += cost/2;
  }
  return { low, high };
}
