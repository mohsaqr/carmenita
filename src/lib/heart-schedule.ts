/**
 * When the little heart beside "Carmenita" is shown. Pure so it can be
 * tested without timers: the component only feeds it elapsed time and
 * random numbers.
 *
 *   • Always visible for the first 10 minutes of a visit.
 *   • Afterwards: hidden for a random 5–20 minutes, then visible for a
 *     random 2–4 minutes, repeating.
 */

const MINUTE = 60_000;

export const HEART_INTRO_MS = 10 * MINUTE;
export const HEART_GAP_MS = { min: 5 * MINUTE, max: 20 * MINUTE } as const;
export const HEART_SHOW_MS = { min: 2 * MINUTE, max: 4 * MINUTE } as const;

/** sessionStorage key holding the visit start (ms since epoch). */
export const HEART_START_KEY = "carmenita-heart-start";

export interface HeartPhase {
  visible: boolean;
  /** Milliseconds until the next change of visibility. */
  durationMs: number;
}

/** `rand` in [0, 1) → a duration in [min, max). */
function between(range: { min: number; max: number }, rand: number): number {
  return range.min + rand * (range.max - range.min);
}

/**
 * The phase to start in when the page loads `elapsedMs` into the visit.
 * Inside the intro: visible until the intro ends. After it: a fresh
 * random hidden gap (we do not try to replay where a previous page load
 * was in its random cycle).
 */
export function initialHeartPhase(elapsedMs: number, rand: number): HeartPhase {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < HEART_INTRO_MS) {
    return { visible: true, durationMs: HEART_INTRO_MS - elapsed };
  }
  return { visible: false, durationMs: between(HEART_GAP_MS, rand) };
}

/** The phase that follows `current`: shown ↔ hidden, random length. */
export function nextHeartPhase(current: HeartPhase, rand: number): HeartPhase {
  return current.visible
    ? { visible: false, durationMs: between(HEART_GAP_MS, rand) }
    : { visible: true, durationMs: between(HEART_SHOW_MS, rand) };
}
