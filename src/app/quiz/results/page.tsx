/**
 * `/quiz/results/?quizId=...&attemptId=...` — static shell for
 * viewing an attempt's results. AttemptIds are runtime (created when
 * a user starts an attempt), so we can't pre-render them per id.
 * The same static page works for every (quizId, attemptId) pair by
 * reading both from searchParams.
 */
import { Suspense } from "react";
import Results from "../[id]/results/[attemptId]/Results.client";
import ResultsQueryShell from "./ResultsQueryShell";

export default function ResultsIndexPage() {
  return (
    <Suspense fallback={null}>
      <ResultsQueryShell Results={Results} />
    </Suspense>
  );
}
