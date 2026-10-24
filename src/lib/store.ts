import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createServerStorage } from "@/lib/server-storage";
import type { ProviderConfig, SystemSettings, SupportedProvider } from "@/types";

/**
 * Carmenita client-side store. Persists provider configs + system
 * settings to the database (per signed-in user) under settings key
 * "carmenita-storage", via `createServerStorage()`.
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
    "claude-sonnet-5-5",
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
  // A LiteLLM proxy (OpenAI-compatible, Bearer key). Kept after `custom`
  // so "Add provider → custom" still copies the blank custom template.
  // Model left empty: the proxy decides which ids exist — "Load models".
  dynasite: defaultProvider("dynasite", "custom", "Dynasite", "", {
    baseUrl: "https://api.dynasite.org/v1",
  }),
};

/**
 * Model ids the provider has retired, mapped to their replacement. Saved
 * configs keep whatever model they were seeded with, so without this a
 * user who opened Settings before a retirement stays on a dead id.
 */
const RETIRED_MODELS: Record<string, string> = {
  "claude-3-5-sonnet-20241022": "claude-sonnet-5-5",
  "claude-3-5-sonnet-20240620": "claude-sonnet-5-5",
};

export function replaceRetiredModels(
  providers: Record<string, ProviderConfig>,
): Record<string, ProviderConfig> {
  return Object.fromEntries(
    Object.entries(providers).map(([id, p]) => {
      const replacement = RETIRED_MODELS[p.defaultModel];
      return [id, replacement ? { ...p, defaultModel: replacement } : p];
    }),
  );
}

/** True for the providers Carmenita ships with; those can't be removed. */
export function isBuiltInProvider(id: string): boolean {
  return Object.hasOwn(DEFAULT_PROVIDERS, id);
}

/**
 * Adds another provider of `type` — a second custom URL, or a second
 * model on a provider already set up. It starts from the built-in
 * defaults for that type (base URL, local placeholder key) with an empty
 * model, under a fresh id `<type>-<n>`.
 */
export function addProvider(
  providers: Record<string, ProviderConfig>,
  type: SupportedProvider,
): { providers: Record<string, ProviderConfig>; id: string } {
  const template = Object.values(DEFAULT_PROVIDERS).find((p) => p.providerType === type);
  const taken = new Set(Object.keys(providers));
  let n = 2;
  while (taken.has(`${type}-${n}`)) n += 1;
  const id = `${type}-${n}`;
  const base = template ?? defaultProvider(id, type, type, "");
  const config: ProviderConfig = {
    ...base,
    id,
    displayName: `${base.displayName} ${n}`,
    defaultModel: "",
    isEnabled: true,
  };
  return { providers: { ...providers, [id]: config }, id };
}

/** Removes an added provider; clears the active choice if it was that one. */
export function removeProvider(
  providers: Record<string, ProviderConfig>,
  activeProviderId: string | null,
  id: string,
): { providers: Record<string, ProviderConfig>; activeProviderId: string | null } {
  if (isBuiltInProvider(id)) return { providers, activeProviderId };
  const rest = Object.fromEntries(Object.entries(providers).filter(([key]) => key !== id));
  return { providers: rest, activeProviderId: activeProviderId === id ? null : activeProviderId };
}

/**
 * The models a provider offers in the picker: its ticked `models` plus
 * the current `defaultModel` (so a saved setup from before the list
 * existed, or a hand-typed id, still shows). Order kept, no blanks.
 */
export function providerModels(provider: ProviderConfig): string[] {
  const all = [...(provider.models ?? []), provider.defaultModel].map((m) => m.trim());
  return [...new Set(all.filter(Boolean))];
}

/**
 * Ticks or unticks one model. Unticking the current model moves the
 * provider to its next ticked one (or none); ticking the first model of
 * a provider with no current model makes it current.
 */
export function toggleModel(
  provider: ProviderConfig,
  model: string,
  on: boolean,
): Pick<ProviderConfig, "models" | "defaultModel"> {
  const id = model.trim();
  const current = providerModels(provider);
  const models = on
    ? [...new Set([...current, id].filter(Boolean))]
    : current.filter((m) => m !== id);
  const defaultModel = models.includes(provider.defaultModel) ? provider.defaultModel : models[0] ?? "";
  return { models, defaultModel };
}

export interface PickerGroup {
  providerId: string;
  displayName: string;
  models: string[];
}

/** The header picker's groups: enabled providers that offer a model. */
export function pickerGroups(providers: Record<string, ProviderConfig>): PickerGroup[] {
  return Object.values(providers)
    .filter((p) => p.isEnabled)
    .map((p) => ({ providerId: p.id, displayName: p.displayName, models: providerModels(p) }))
    .filter((g) => g.models.length > 0);
}

interface AppState {
  providers: Record<string, ProviderConfig>;
  activeProviderId: string | null;
  systemSettings: SystemSettings;
  setProviderConfig: (id: string, patch: Partial<ProviderConfig>) => void;
  setActiveProvider: (id: string | null) => void;
  /** Header picker: make `providerId` active, running `model`. */
  selectModel: (providerId: string, model: string) => void;
  addProvider: (type: SupportedProvider) => string;
  removeProvider: (id: string) => void;
  setSystemSettings: (patch: Partial<SystemSettings>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
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
      selectModel: (providerId, model) =>
        set((state) => {
          const provider = state.providers[providerId];
          if (!provider) return {};
          return {
            activeProviderId: providerId,
            providers: { ...state.providers, [providerId]: { ...provider, defaultModel: model } },
          };
        }),
      addProvider: (type) => {
        const added = addProvider(get().providers, type);
        set({ providers: added.providers });
        return added.id;
      },
      removeProvider: (id) =>
        set((state) => removeProvider(state.providers, state.activeProviderId, id)),
      setSystemSettings: (patch) =>
        set((state) => ({
          systemSettings: { ...state.systemSettings, ...patch },
        })),
    }),
    {
      name: "carmenita-storage",
      storage: createJSONStorage(() => createServerStorage()),
      merge: (persisted: unknown, current: AppState): AppState => {
        const saved = persisted as Partial<AppState>;
        return {
          ...current,
          providers: replaceRetiredModels({
            ...DEFAULT_PROVIDERS,
            ...(saved?.providers ?? {}),
          }),
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
