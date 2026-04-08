/**
 * Server wrapper — exists only so `generateStaticParams` can live in a
 * Server Component. See the sibling `../page.tsx` for a full explanation
 * of why the split is needed under `output: "export"`.
 */
import QuizAnalytics from "./Analytics.client";
import { getStaticQuizIds } from "@/lib/local-api/static-params";

export async function generateStaticParams() {
  const ids = await getStaticQuizIds();
  return ids.map((id) => ({ id }));
}

export const dynamicParams = false;

export default async function QuizAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuizAnalytics quizId={id} />;
}
