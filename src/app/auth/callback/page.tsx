"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { handleOAuthCallback } from "@/lib/google-auth";
import { findDbFile, downloadDb } from "@/lib/google-drive";

function CallbackHandler() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Signing in...");

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot OAuth callback, no cascading renders
      setError("No authorization code received.");
      return;
    }

    (async () => {
      try {
        await handleOAuthCallback(code);

        // Check if Drive already has a DB (cross-device sync)
        setStatus("Checking Google Drive...");
        const existing = await findDbFile();
        if (existing) {
          setStatus("Downloading your data...");
          const bytes = await downloadDb();
          // Store in IndexedDB so the sql.js DB picks it up on next load
          const idbReq = indexedDB.open("carmenita-local", 1);
          idbReq.onupgradeneeded = () => idbReq.result.createObjectStore("blobs");
          idbReq.onsuccess = () => {
            const tx = idbReq.result.transaction("blobs", "readwrite");
            tx.objectStore("blobs").put(bytes, "carmenita.db.blob");
          };
        }

        const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        router.replace(`${base}/`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed.");
      }
    })();
  }, [params, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-md py-20 text-center space-y-4">
        <h1 className="text-xl font-semibold text-destructive">Sign-in failed</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link href="/" className="text-sm underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-20 text-center space-y-4">
      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
      <p className="text-sm text-muted-foreground">{status}</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-muted-foreground">Processing...</p>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
