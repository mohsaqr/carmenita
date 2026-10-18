/**
 * Topic → quiz runs are split into requests of at most this many questions.
 *
 * carmenita.lacarm.com sits behind a Cloudflare tunnel that drops any
 * response slower than ~100 s. Measured on claude-sonnet-5-5: 10 questions
 * in 27.5 s, so 20 is ~55 s — inside the limit with room for a slow model.
 * Batching inside one request would not help: the limit is per request.
 */
export const TOPIC_BATCH_SIZE = 20;

/**
 * Split a question count into batch sizes, largest first, none above `size`
 * (45 → [20, 20, 5]). Empty for a count below 1.
 */
export function batchSizes(total: number, size: number = TOPIC_BATCH_SIZE): number[] {
  if (!Number.isFinite(total) || total < 1 || size < 1) return [];
  const whole = Math.floor(total);
  const full = Math.floor(whole / size);
  const rest = whole % size;
  return [...Array.from({ length: full }, () => size), ...(rest > 0 ? [rest] : [])];
}
