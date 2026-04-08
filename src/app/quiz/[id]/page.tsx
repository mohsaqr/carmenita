/**
 * Server wrapper for the quiz runner. The runner itself is a client
 * component (`Runner.client.tsx`). This file exists because Next.js
 * requires `generateStaticParams` to live in a Server Component when
 * `output: "export"` is used — a "use client" page cannot export it.
 *
 * In static build mode, we pre-render the 14 shipped lecture quizzes
 * (their IDs come from the build-time DB read). User-created quizzes
 * in the browser still work because all navigation goes through the
 * same client bundle and the fetch interceptor serves them from the
 * in-browser sql.js DB; however, deep-linking to a user-created quiz
 * URL won't work on pure GitHub Pages without SPA fallback.
 *
 * In normal (non-static) mode, `generateStaticParams` is a no-op —
 * Next renders the page dynamically at request time.
 */
import Runner from "./Runner.client";
import { getStaticQuizIds } from "@/lib/local-api/static-params";

export async function generateStaticParams() {
  const ids = await getStaticQuizIds();
  return ids.map((id) => ({ id }));
}

// In `output: "export"` mode Next only emits the IDs returned by
// generateStaticParams. User-created quizzes in the browser get handled
// by the SPA 404 redirect (scripts/build-static.sh writes a 404.html
// that routes back to the runner page with the real id in the URL).
export const dynamicParams = false;

export default async function QuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Runner id={id} />;
}
