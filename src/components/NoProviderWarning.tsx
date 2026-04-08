"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Amber warning banner for pages that need a configured provider but
 * the user hasn't set one up yet. Inlined rather than using shadcn
 * Alert to keep dependencies minimal.
 */
export function NoProviderWarning() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">No LLM provider configured</p>
        <p className="text-muted-foreground mt-0.5">
          You need an active provider with an API key before you can generate quizzes.{" "}
          <Link href="/settings" className="underline font-medium">
            Open Settings
          </Link>{" "}
          to add one.
        </p>
      </div>
    </div>
  );
}
