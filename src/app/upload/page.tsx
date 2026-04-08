"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy `/upload` route. Redirects to the unified `/create` page.
 *
 * Kept as a client-side redirect (not `next.config.ts` rewrites) so
 * existing bookmarks and header-nav links work without requiring a
 * server config change, and so the redirect logic stays co-located
 * with the page that owns it.
 */
export default function UploadPageRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/create");
  }, [router]);
  return (
    <div className="mx-auto max-w-md text-center py-20 text-sm text-muted-foreground">
      Redirecting to <span className="font-medium">/create</span>…
    </div>
  );
}
