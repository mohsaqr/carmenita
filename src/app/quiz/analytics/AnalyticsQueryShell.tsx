"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";

export default function AnalyticsQueryShell({
  QuizAnalytics,
}: {
  QuizAnalytics: ComponentType<{ quizId: string }>;
}) {
  const sp = useSearchParams();
  const id = sp.get("id");
  if (!id) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-3">
        <p className="text-destructive font-medium">No quiz id provided.</p>
        <Link href="/">
          <Button variant="outline">Dashboard</Button>
        </Link>
      </div>
    );
  }
  return <QuizAnalytics quizId={id} />;
}
