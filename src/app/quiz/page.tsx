/**
 * `/quiz` (with no id segment) is the static shell for runtime-created
 * quizzes — quizzes that the user built in the browser via /take or
 * the bank assembly flow. Their IDs are UUIDs chosen at click time,
 * so we can't pre-render them during the build. Instead, /take
 * navigates to `/quiz/?id=<new-uuid>` and this page reads the id out
 * of searchParams before handing off to the runner client component.
 *
 * The 18 shipped lecture quizzes still deep-link cleanly via their
 * own pre-rendered `/quiz/[id]/` pages.
 *
 * The post-build 404.html fallback (scripts/inject-shim.mjs) also
 * rewrites `/quiz/<unknown-id>/` paths to this shell with the id
 * preserved in a query param, so any legacy link that follows the
 * old path-based URL still works.
 */
import { Suspense } from "react";
import Runner from "./[id]/Runner.client";
import QuizRunnerQueryShell from "./QueryShell";

export default function QuizIndexPage() {
  return (
    <Suspense fallback={null}>
      <QuizRunnerQueryShell Runner={Runner} />
    </Suspense>
  );
}
