/**
 * Display helpers for the chat page. Browser-safe: no server imports.
 */

export interface UsageLike {
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

/** "$0.0012" — enough digits that a cheap call doesn't read as $0.00. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

/**
 * "1,234 in · 210 out · $0.0012". Each part only when the provider reported
 * it; an empty string when it reported nothing.
 */
export function formatUsage(usage: UsageLike): string {
  const parts: string[] = [];
  if (typeof usage.inputTokens === "number") parts.push(`${usage.inputTokens.toLocaleString("en-US")} in`);
  if (typeof usage.outputTokens === "number") parts.push(`${usage.outputTokens.toLocaleString("en-US")} out`);
  if (typeof usage.costUsd === "number") parts.push(formatCost(usage.costUsd));
  return parts.join(" · ");
}

export interface ChatTotals {
  inputTokens: number;
  outputTokens: number;
  /** Null unless every reply came with a price — a partial sum would understate the cost. */
  costUsd: number | null;
}

/** What a conversation used so far, summed over its assistant replies. */
export function chatTotals(messages: (UsageLike & { role: string })[]): ChatTotals {
  const replies = messages.filter((m) => m.role === "assistant");
  const priced = replies.every((m) => typeof m.costUsd === "number");
  return {
    inputTokens: replies.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0),
    outputTokens: replies.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0),
    costUsd: replies.length > 0 && priced ? replies.reduce((sum, m) => sum + (m.costUsd ?? 0), 0) : null,
  };
}
