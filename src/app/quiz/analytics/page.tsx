/**
 * `/quiz/analytics/?id=...` — static shell for viewing per-quiz
 * analytics. Query-param form so runtime-created quizzes work too.
 */
import { Suspense } from "react";
import QuizAnalytics from "../[id]/analytics/Analytics.client";
import AnalyticsQueryShell from "./AnalyticsQueryShell";

export default function AnalyticsIndexPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsQueryShell QuizAnalytics={QuizAnalytics} />
    </Suspense>
  );
}
