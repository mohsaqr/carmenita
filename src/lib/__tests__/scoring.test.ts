import { describe, it, expect } from "vitest";
import {
  resolveScoringMethod,
  scoreQuestion,
  SCORING_METHODS,
  toPoints,
  type ScoringMethod,
} from "@/lib/scoring";

// Options A..E → indices 0..4 (UMCH exams always have 5 options).
const L = (s: string) => s.split(",").map((c) => "ABCDE".indexOf(c.trim()));
const umch = (correct: string, selected: string) =>
  toPoints(scoreQuestion("umch", "mcq-multi", L(correct), L(selected), 5));

/**
 * Every worked example from the UMCH "full match method" rules sheet,
 * sorted back into its question type (the pasted text interleaved the
 * three columns). Expected points are the sheet's formula evaluated.
 */
describe("UMCH full match — the official worked examples", () => {
  it("2 correct answers (A, B)", () => {
    expect(umch("A,B", "A,B")).toBe(10); //       (2+3) x 2
    expect(umch("A,B", "A,B,C")).toBe(8); //      (2+2) x 2
    expect(umch("A,B", "A,B,C,D")).toBe(6); //    (2+1) x 2
    expect(umch("A,B", "A,C")).toBe(6); //        (1+2) x 2
    expect(umch("A,B", "C,D,E")).toBe(0); //      (0+0) x 2
  });

  it("3 correct answers (A, B, C)", () => {
    expect(umch("A,B,C", "A,B,C")).toBe(10); //   (3+2) x 2
    expect(umch("A,B,C", "A,B")).toBe(8); //      (2+2) x 2
    expect(umch("A,B,C", "A,B,D")).toBe(6); //    (2+1) x 2
    expect(umch("A,B,C", "A,B,D,E")).toBe(4); //  (2+0) x 2
    expect(umch("A,B,C", "A,B,C,D")).toBe(8); //  (3+1) x 2
    // Sheet prints "A, D: (1+1) x 2 = 2" — the formula gives 4.
    expect(umch("A,B,C", "A,D")).toBe(4);
    expect(umch("A,B,C", "A,C,D")).toBe(6); //    (2+1) x 2
  });

  it("4 correct answers (A, B, C, D)", () => {
    expect(umch("A,B,C,D", "A,B,C,D")).toBe(10); // (4+1) x 2
    expect(umch("A,B,C,D", "A,B,C")).toBe(8); //    (3+1) x 2
    expect(umch("A,B,C,D", "A,B,C,E")).toBe(6); // (3+0) x 2
    expect(umch("A,B,C,D", "A,B")).toBe(6); //      (2+1) x 2
    expect(umch("A,B,C,D", "A,B,E")).toBe(4); //    (2+0) x 2
    expect(umch("A,B,C,D", "A,E")).toBe(2); //      (1+0) x 2
    expect(umch("A,B,C,D", "A,C,D")).toBe(8); //    (3+1) x 2
  });

  it("cancelled: exactly one option, or all options, selected → 0", () => {
    expect(umch("A,B", "A")).toBe(0);
    expect(umch("A,B,C", "B")).toBe(0);
    expect(umch("A,B", "A,B,C,D,E")).toBe(0);
    expect(umch("A,B,C,D", "A,B,C,D,E")).toBe(0);
  });

  it("score is always within 0..10 and 10 only for the exact answer", () => {
    // Every correct-set of size 2..4 × every non-empty selection.
    const subsets = Array.from({ length: 31 }, (_, m) => m + 1).map((m) =>
      [0, 1, 2, 3, 4].filter((i) => m & (1 << i)),
    );
    subsets
      .filter((c) => c.length >= 2 && c.length <= 4)
      .forEach((correct) =>
        subsets.forEach((sel) => {
          const p = scoreQuestion("umch", "mcq-multi", correct, sel, 5);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          const exact = sel.length === correct.length && sel.every((i) => correct.includes(i));
          expect(p === 1).toBe(exact);
        }),
      );
  });
});

describe("single-answer questions are all or nothing under every method", () => {
  it.each(SCORING_METHODS)("%s", (method: ScoringMethod) => {
    expect(scoreQuestion(method, "mcq-single", 2, 2, 5)).toBe(1);
    expect(scoreQuestion(method, "mcq-single", 2, 3, 5)).toBe(0);
    expect(scoreQuestion(method, "true-false", 0, 0, 2)).toBe(1);
    expect(scoreQuestion(method, "true-false", 0, 1, 2)).toBe(0);
    expect(scoreQuestion(method, "mcq-single", 2, null, 5)).toBe(0);
  });
});

describe("partial credit (wrong pick → 0)", () => {
  const partial = (c: string, s: string) => toPoints(scoreQuestion("partial", "mcq-multi", L(c), L(s), 5));
  it("scores the share of correct options picked", () => {
    expect(partial("A,B", "A")).toBe(5); // 1 of 2 correct → 0.5
    expect(partial("A,B", "A,B")).toBe(10);
    expect(partial("A,B,C", "A,B")).toBeCloseTo(6.7, 5);
    expect(partial("A,B,C,D", "A")).toBe(2.5);
  });
  it("any wrong pick scores 0 (ticking everything never pays)", () => {
    expect(partial("A,B", "A,C")).toBe(0);
    expect(partial("A,B", "A,B,C")).toBe(0);
    expect(partial("A,B", "A,B,C,D,E")).toBe(0);
  });
});

describe("cancelling (+1 / −1)", () => {
  const cancel = (c: string, s: string) => toPoints(scoreQuestion("cancelling", "mcq-multi", L(c), L(s), 5));
  it("a right and a wrong cancel out; never below 0", () => {
    expect(cancel("A,B", "A,C")).toBe(0); // 1 + -1 = 0
    expect(cancel("A,B", "A")).toBe(5);
    expect(cancel("A,B", "A,B")).toBe(10);
    expect(cancel("A,B", "A,B,C")).toBe(5); // (2 - 1) / 2
    expect(cancel("A,B", "C,D,E")).toBe(0); // (0 - 3) floored
  });
});

describe("all-or-nothing (scoring off) keeps the original behaviour", () => {
  const aon = (c: string, s: string) => scoreQuestion("all-or-nothing", "mcq-multi", L(c), L(s), 5);
  it("only the exact set scores", () => {
    expect(aon("A,B", "A,B")).toBe(1);
    expect(aon("A,B", "B,A")).toBe(1);
    expect(aon("A,B", "A")).toBe(0);
    expect(aon("A,B", "A,B,C")).toBe(0);
  });
});

describe("robustness", () => {
  it("unanswered and empty selections score 0 under every method", () => {
    SCORING_METHODS.forEach((m) => {
      expect(scoreQuestion(m, "mcq-multi", [0, 1], null, 5)).toBe(0);
      expect(scoreQuestion(m, "mcq-multi", [0, 1], [], 5)).toBe(0);
    });
  });
  it("ignores duplicate and out-of-range picks", () => {
    expect(scoreQuestion("umch", "mcq-multi", [0, 1], [0, 0, 1, 1, 9, -1], 5)).toBe(1);
  });
  it("selection order doesn't matter", () => {
    expect(scoreQuestion("umch", "mcq-multi", [0, 1, 2], [2, 0], 5)).toBe(scoreQuestion("umch", "mcq-multi", [0, 1, 2], [0, 2], 5));
  });
});

describe("resolveScoringMethod: quiz override > account default > fallback", () => {
  it("prefers the quiz, then the account, then the fallback; ignores junk", () => {
    expect(resolveScoringMethod("partial", "umch", "all-or-nothing")).toBe("partial");
    expect(resolveScoringMethod(undefined, "cancelling", "all-or-nothing")).toBe("cancelling");
    expect(resolveScoringMethod(null, null, "umch")).toBe("umch");
    expect(resolveScoringMethod("bogus", 42, "umch")).toBe("umch");
  });
});
