"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

/**
 * Reports crashes nobody caught — a thrown error or a rejected promise in
 * any page — to the server log (see src/lib/client-errors.ts). Renders
 * nothing.
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError("window.error", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError("unhandled.rejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
