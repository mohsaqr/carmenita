"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";

export default function ResultsQueryShell({
  Results,
}: {
  Results: ComponentType<{ quizId: string; attemptId: string }>;
}) {
  const sp = useSearchParams();
  const quizId = sp.get("quizId");
  const attemptId = sp.get("attemptId");

  if (!quizId || !attemptId) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-3">
        <p className="text-destructive font-medium">
          Missing quiz or attempt id.
        </p>
        <Link href="/attempts">
          <Button variant="outline">Attempts</Button>
        </Link>
      </div>
    );
  }
  return <Results quizId={quizId} attemptId={attemptId} />;
}
