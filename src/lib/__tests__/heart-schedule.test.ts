import { describe, it, expect } from "vitest";
import {
  HEART_GAP_MS,
  HEART_INTRO_MS,
  HEART_SHOW_MS,
  initialHeartPhase,
  nextHeartPhase,
} from "@/lib/heart-schedule";

const MINUTE = 60_000;

describe("initialHeartPhase", () => {
  it("is visible for the rest of the first 10 minutes", () => {
    expect(initialHeartPhase(0, 0.5)).toEqual({ visible: true, durationMs: 10 * MINUTE });
    expect(initialHeartPhase(3 * MINUTE, 0.5)).toEqual({ visible: true, durationMs: 7 * MINUTE });
  });

  it("treats a negative elapsed time (clock skew) as the start of the visit", () => {
    expect(initialHeartPhase(-5000, 0.5)).toEqual({ visible: true, durationMs: HEART_INTRO_MS });
  });

  it("starts hidden for a 5–20 minute gap once the intro is over", () => {
    expect(initialHeartPhase(HEART_INTRO_MS, 0)).toEqual({ visible: false, durationMs: 5 * MINUTE });
    expect(initialHeartPhase(60 * MINUTE, 0.5).visible).toBe(false);
    expect(initialHeartPhase(60 * MINUTE, 0.5).durationMs).toBe(12.5 * MINUTE);
  });
});

describe("nextHeartPhase", () => {
  it("alternates visible and hidden", () => {
    const shown = { visible: true, durationMs: 1 };
    const hidden = { visible: false, durationMs: 1 };
    expect(nextHeartPhase(shown, 0.5).visible).toBe(false);
    expect(nextHeartPhase(hidden, 0.5).visible).toBe(true);
  });

  it("keeps every random duration inside its range", () => {
    const rands = [0, 0.001, 0.25, 0.5, 0.75, 0.999];
    rands.forEach((r) => {
      const gap = nextHeartPhase({ visible: true, durationMs: 1 }, r).durationMs;
      const show = nextHeartPhase({ visible: false, durationMs: 1 }, r).durationMs;
      expect(gap).toBeGreaterThanOrEqual(HEART_GAP_MS.min);
      expect(gap).toBeLessThan(HEART_GAP_MS.max);
      expect(show).toBeGreaterThanOrEqual(HEART_SHOW_MS.min);
      expect(show).toBeLessThan(HEART_SHOW_MS.max);
    });
  });

  it("shows for 2–4 minutes", () => {
    expect(HEART_SHOW_MS).toEqual({ min: 2 * MINUTE, max: 4 * MINUTE });
  });
});
