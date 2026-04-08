import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProviderConfig, SystemSettings, SupportedProvider } from "@/types";

/**
 * Carmenita client-side store. Persists provider configs + system
 * settings to localStorage under key "carmenita-storage".
 *
 * Uses the same `persist` + `merge` pattern as handai's store so that
 * new providers added in future versions appear automatically for
 * existing users. NOTE: we intentionally do NOT read handai-storage —
 * API keys must be configured separately in Carmenita.
 */

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  temperature: 0.3,
  maxTokens: null,
  autoRetry: true,
};

const defaultProvider = (
  id: string,
  providerType: SupportedProvider,
  displayName: string,
  defaultModel: string,
  extras: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  id,
  providerType,
  displayName,
  apiKey: "",
  defaultModel,
  isEnabled: true,
  ...extras,
});

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  openai: defaultProvider("openai", "openai", "OpenAI", "gpt-4o"),
  anthropic: defaultProvider(
    "anthropic",
    "anthropic",
    "Anthropic",
    "claude-3-5-sonnet-20241022",
  ),
  google: defaultProvider("google", "google", "Google (Gemini)", "gemini-1.5-pro"),
  groq: defaultProvider("groq", "groq", "Groq", "llama-3.3-70b-versatile"),
  together: defaultProvider(
    "together",
    "together",
    "Together.ai",
    "meta-llama/Llama-3-70b-chat-hf",
    { baseUrl: "https://api.together.xyz/v1", isEnabled: false },
  ),
  azure: defaultProvider("azure", "azure", "Azure OpenAI", "gpt-4o", {
    baseUrl: "",
    isEnabled: false,
  }),
  openrouter: defaultProvider(
    "openrouter",
    "openrouter",
    "OpenRouter",
    "anthropic/claude-3.5-sonnet",
    { baseUrl: "https://openrouter.ai/api/v1" },
  ),
  ollama: defaultProvider("ollama", "ollama", "Ollama (local)", "llama3", {
    apiKey: "ollama",
    baseUrl: "http://localhost:11434/v1",
    isEnabled: false,
  }),
  lmstudio: defaultProvider(
    "lmstudio",
    "lmstudio",
    "LM Studio (local)",
    // Intentionally empty — LM Studio rejects any placeholder model id
    // and demands a real downloaded model name (e.g. "google/gemma-4-26b-a4b").
    // The Settings page has a "Load models" button that probes
    // {baseUrl}/models and populates a dropdown with the real names.
    "",
    {
      apiKey: "lm-studio",
      baseUrl: "http://localhost:1234/v1",
      isEnabled: false,
    },
  ),
  custom: defaultProvider("custom", "custom", "Custom OpenAI-compatible", "", {
    baseUrl: "",
    isEnabled: false,
  }),
};

interface AppState {
  providers: Record<string, ProviderConfig>;
  activeProviderId: string | null;
  systemSettings: SystemSettings;
  setProviderConfig: (id: string, patch: Partial<ProviderConfig>) => void;
  setActiveProvider: (id: string | null) => void;
  setSystemSettings: (patch: Partial<SystemSettings>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      providers: DEFAULT_PROVIDERS,
      activeProviderId: null,
      systemSettings: DEFAULT_SYSTEM_SETTINGS,
      setProviderConfig: (id, patch) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [id]: { ...state.providers[id], ...patch },
          },
        })),
      setActiveProvider: (id) => set({ activeProviderId: id }),
      setSystemSettings: (patch) =>
        set((state) => ({
          systemSettings: { ...state.systemSettings, ...patch },
        })),
    }),
    {
      name: "carmenita-storage",
      merge: (persisted: unknown, current: AppState): AppState => {
        const saved = persisted as Partial<AppState>;
        return {
          ...current,
          providers: {
            ...DEFAULT_PROVIDERS,
            ...(saved?.providers ?? {}),
          },
          activeProviderId: saved?.activeProviderId ?? null,
          systemSettings: {
            ...DEFAULT_SYSTEM_SETTINGS,
            ...(saved?.systemSettings ?? {}),
          },
        };
      },
    },
  ),
);

/** Convenience selector — returns the active provider or null. */
export function getActiveProvider(state: AppState): ProviderConfig | null {
  if (!state.activeProviderId) return null;
  const provider = state.providers[state.activeProviderId];
  return provider ?? null;
}
