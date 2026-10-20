/**
 * Client side of the background generation jobs (see generation-jobs.ts):
 * poll `GET /api/generate-quiz/jobs/[id]` until the job is done.
 *
 * `fetchImpl` and `sleep` are injectable so tests run without a browser
 * or real waiting.
 */

export interface JobOutcome {
  quizId: string;
  questionCount: number;
  dropped?: unknown;
}

export interface PollOptions {
  onProgress?: (done: number, total: number) => void;
  intervalMs?: number;
  /** Network failures in a row before giving up (a blip shouldn't end a 2-minute job). */
  maxFailures?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read a response as JSON. A proxy error page (Cloudflare's HTML 524, for
 * one) becomes an Error naming the status instead of a JSON parse error.
 */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      res.status === 524
        ? "The server took too long to answer (HTTP 524)."
        : `The server sent an unexpected reply (HTTP ${res.status}).`,
    );
  }
}

export async function pollGenerationJob(jobId: string, options: PollOptions = {}): Promise<JobOutcome> {
  const {
    onProgress,
    intervalMs = 2000,
    maxFailures = 5,
    fetchImpl = fetch,
    sleep = wait,
  } = options;
  const url = `/api/generate-quiz/jobs/${encodeURIComponent(jobId)}`;

  const poll = async (failures: number): Promise<JobOutcome> => {
    await sleep(intervalMs);
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      if (failures + 1 >= maxFailures) throw err;
      return poll(failures + 1);
    }
    if (res.status === 404) {
      throw new Error(
        "The generation job was lost, most likely because the server restarted. " +
          "Check your quizzes before trying again — it may have been saved.",
      );
    }
    const data = await readJson(res);
    if (!res.ok) throw new Error(String(data.error ?? `Generation failed (${res.status})`));
    if (data.status === "error") throw new Error(String(data.error ?? "Generation failed"));
    if (data.status === "done") {
      return {
        quizId: String(data.quizId),
        questionCount: Number(data.questionCount),
        dropped: data.dropped,
      };
    }
    onProgress?.(Number(data.done ?? 0), Number(data.total ?? 0));
    return poll(0);
  };

  return poll(0);
}
