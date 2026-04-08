"use client";

import { useAppStore } from "@/lib/store";
import type { ProviderConfig } from "@/types";

/**
 * Returns the currently active provider config, or null if none is
 * selected. Used by pages that need a provider to make LLM calls
 * (upload/generate-quiz).
 */
export function useActiveProvider(): ProviderConfig | null {
  return useAppStore((s) => {
    if (!s.activeProviderId) return null;
    return s.providers[s.activeProviderId] ?? null;
  });
}
