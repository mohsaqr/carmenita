"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";

/**
 * Reads `?id=` from the URL and renders the given `Runner` component
 * with that id as a prop. Factored out of `/quiz/page.tsx` so it can
 * sit inside the required `<Suspense>` boundary without forcing the
 * outer file to be a client component (server components can wrap
 * client components but can't call `useSearchParams` directly).
 */
export default function QuizRunnerQueryShell({
  Runner,
}: {
  Runner: ComponentType<{ id: string }>;
}) {
  const sp = useSearchParams();
  const id = sp.get("id");

  if (!id) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-3">
        <p className="text-destructive font-medium">No quiz id provided.</p>
        <p className="text-sm text-muted-foreground">
          Pick a quiz from the dashboard or start one from the Take page.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <Link href="/">
            <Button variant="outline">Dashboard</Button>
          </Link>
          <Link href="/take">
            <Button>Take a quiz</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <Runner id={id} />;
}
