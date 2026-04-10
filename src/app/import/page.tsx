"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { ImportWizard } from "@/components/import-wizard";

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportPageInner />
    </Suspense>
  );
}

function ImportPageInner() {
  const searchParams = useSearchParams();
  const fromBank = searchParams.get("from") === "bank";

  return (
    <div className="mx-auto max-w-5xl space-y-6" suppressHydrationWarning>
      {fromBank && (
        <Link
          href="/bank"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to bank
        </Link>
      )}

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-6 w-6" />
          <h1 className="text-2xl font-bold tracking-tight">Import questions</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate questions with any chatbot, then import them into Carmenita.
          Choose a format, fill in your details, and follow the steps.
        </p>
      </header>

      <ImportWizard />
    </div>
  );
}
