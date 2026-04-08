import { describe, it, expect, vi } from "vitest";
import { withRetry } from "@/lib/retry";

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient errors", async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(() => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new Error("network timeout"));
      return Promise.resolve("eventually");
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe("eventually");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails fast on 401 auth errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("401 invalid api key"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fails fast on 400 bad request errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("bad request: invalid params"));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts attempts and throws last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("transient"));
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow("transient");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
