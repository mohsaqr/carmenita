/**
 * Server wrapper — see ../../page.tsx for the full explanation of why
 * dynamic-route pages need to split into page.tsx (server, with
 * generateStaticParams) + *.client.tsx (the actual UI).
 *
 * Results pages have TWO dynamic params (quiz id + attempt id). In
 * static mode we can't enumerate attempt ids at build time (they come
 * from runtime user activity), so we return a single sentinel attempt
 * id per shipped quiz so Next still emits the HTML shell. Actual data
 * is loaded client-side from the fetch interceptor / localStorage.
 */
import Results from "./Results.client";
import { getStaticQuizIds } from "@/lib/local-api/static-params";

export async function generateStaticParams() {
  const ids = await getStaticQuizIds();
  return ids.map((id) => ({ id, attemptId: "_" }));
}

export const dynamicParams = false;

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string; attemptId: string }>;
}) {
  const { id, attemptId } = await params;
  return <Results quizId={id} attemptId={attemptId} />;
}
