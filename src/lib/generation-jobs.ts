import { randomUUID } from "node:crypto";

/**
 * Background generation jobs.
 *
 * carmenita.lacarm.com sits behind a Cloudflare tunnel that ends any
 * request after ~100 s (HTTP 524), and a document quiz can take longer
 * than that. So the generate route starts the work here and returns a job
 * id at once; the page polls `GET /api/generate-quiz/jobs/[id]` until the
 * job is done. The work keeps running after the request that started it
 * has returned.
 *
 * Jobs live in memory on `globalThis` (like the DB client), so they
 * survive dev HMR but not a server restart — a poll for a lost job gets
 * 404 and the page says so. Finished jobs are kept for JOB_TTL_MS so a
 * page that polls late still gets the result.
 */

export interface JobResult {
  quizId: string;
  questionCount: number;
  dropped?: unknown;
}

export interface GenerationJob {
  id: string;
  userId: string;
  status: "running" | "done" | "error";
  /** Steps finished so far (document chunks), out of `total`. */
  done: number;
  total: number;
  result?: JobResult;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** How long a finished job stays readable. */
export const JOB_TTL_MS = 60 * 60 * 1000;

declare global {
  var __carmenitaJobs: Map<string, GenerationJob> | undefined;
}

function jobs(): Map<string, GenerationJob> {
  globalThis.__carmenitaJobs ??= new Map();
  return globalThis.__carmenitaJobs;
}

/** Drop finished jobs older than JOB_TTL_MS. */
export function pruneJobs(now = Date.now()): void {
  const all = jobs();
  [...all.values()]
    .filter((job) => job.finishedAt !== undefined && now - job.finishedAt > JOB_TTL_MS)
    .forEach((job) => all.delete(job.id));
}

/**
 * Start `work` in the background and return the job at once. `work`
 * reports progress through `progress(done, total)`; its result or error
 * is stored on the job. The returned promise of `work` is never left
 * unhandled.
 */
export function startJob(
  userId: string,
  total: number,
  work: (progress: (done: number, total: number) => void) => Promise<JobResult>,
): GenerationJob {
  pruneJobs();
  const job: GenerationJob = {
    id: randomUUID(),
    userId,
    status: "running",
    done: 0,
    total,
    startedAt: Date.now(),
  };
  jobs().set(job.id, job);

  const progress = (done: number, newTotal: number) => {
    job.done = done;
    job.total = newTotal;
  };
  work(progress).then(
    (result) => {
      job.status = "done";
      job.result = result;
      job.finishedAt = Date.now();
    },
    (err: unknown) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = Date.now();
      console.error(`[job] ${job.id} failed after ${job.finishedAt - job.startedAt}ms: ${job.error}`);
    },
  );
  return job;
}

/** The job, if it exists and belongs to `userId` — a foreign id reads as missing. */
export function getJob(userId: string, id: string): GenerationJob | undefined {
  const job = jobs().get(id);
  return job && job.userId === userId ? job : undefined;
}
