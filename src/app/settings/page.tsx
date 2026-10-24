"use client";

import { useState, useEffect } from "react";
import { isBuiltInProvider, providerModels, toggleModel, useAppStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { PROMPTS } from "@/lib/prompts";
import {
  SCORING_LABELS,
  SCORING_METHODS,
  SCORING_SETTING_KEY,
  SERVER_DEFAULT_SCORING,
  STATIC_DEFAULT_SCORING,
  isScoringMethod,
  type ScoringMethod,
} from "@/lib/scoring";
import {
  clearPromptOverride,
  fetchPromptOverride,
  savePromptOverride,
} from "@/lib/prompt-overrides-client";
import type { ProviderConfig, SupportedProvider } from "@/types";

const ADDABLE_TYPES: { type: SupportedProvider; label: string }[] = [
  { type: "custom", label: "Custom OpenAI-compatible URL" },
  { type: "openai", label: "OpenAI" },
  { type: "anthropic", label: "Anthropic" },
  { type: "google", label: "Google (Gemini)" },
  { type: "groq", label: "Groq" },
  { type: "together", label: "Together.ai" },
  { type: "azure", label: "Azure OpenAI" },
  { type: "openrouter", label: "OpenRouter" },
  { type: "ollama", label: "Ollama (local)" },
  { type: "lmstudio", label: "LM Studio (local)" },
];

/**
 * Settings page. Lets the user:
 *  - Configure each of the 10 LLM providers (API key, base URL, model)
 *  - Toggle each provider enabled/disabled
 *  - Add more providers (extra custom URLs, a second model on one provider)
 *  - Select the ACTIVE provider (also switchable from the header picker)
 *  - Edit the MCQ generation prompt (saved to the database)
 *  - Adjust system settings (temperature, autoRetry)
 */
export default function SettingsPage() {
  const {
    providers,
    activeProviderId,
    systemSettings,
    setProviderConfig,
    setActiveProvider,
    addProvider,
    removeProvider,
    setSystemSettings,
  } = useAppStore();

  const providerList = Object.values(providers);
  const [newType, setNewType] = useState<SupportedProvider>("custom");

  return (
    // suppressHydrationWarning: password-manager extensions flag the API
    // key inputs here and inject data attributes. Element-scoped, does
    // not cascade — children still warn on legitimate mismatches.
    <div className="mx-auto max-w-4xl space-y-6" suppressHydrationWarning>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure your LLM providers and the quiz-generation prompt. Settings
          and API keys are saved to your account in the Carmenita database, so
          they follow you to any browser you sign in from.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>System settings</CardTitle>
          <CardDescription>Applied to every LLM call.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={systemSettings.temperature ?? 0.3}
                onChange={(e) =>
                  setSystemSettings({ temperature: parseFloat(e.target.value) })
                }
              />
            </div>
            <div className="flex items-end gap-3 pb-0.5">
              <Switch
                id="autoRetry"
                checked={systemSettings.autoRetry}
                onCheckedChange={(checked) => setSystemSettings({ autoRetry: checked })}
              />
              <Label htmlFor="autoRetry">Auto-retry on transient errors</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Click a provider to configure it. The highlighted one is active; switch
            between enabled ones from the model picker at the top of any page. Add
            as many as you need — several custom URLs, or two models on one provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providerList.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              isActive={activeProviderId === provider.id}
              onActivate={() => setActiveProvider(provider.id)}
              onChange={(patch) => setProviderConfig(provider.id, patch)}
              onRemove={
                isBuiltInProvider(provider.id) ? undefined : () => removeProvider(provider.id)
              }
            />
          ))}
          <div className="flex items-center gap-2 border-t pt-4">
            <Select value={newType} onValueChange={(v) => setNewType(v as SupportedProvider)}>
              <SelectTrigger className="w-72" aria-label="Provider type to add">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADDABLE_TYPES.map((t) => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                addProvider(newType);
                toast.success("Provider added — open Edit to set its URL, key and model");
              }}
            >
              Add provider
            </Button>
          </div>
        </CardContent>
      </Card>

      <ScoringCard />

      <PromptEditorCard />
    </div>
  );
}

function ProviderRow({
  provider,
  isActive,
  onActivate,
  onChange,
  onRemove,
}: {
  provider: ProviderConfig;
  isActive: boolean;
  onActivate: () => void;
  onChange: (patch: Partial<ProviderConfig>) => void;
  /** Present only for providers the user added. */
  onRemove?: () => void;
}) {
  const ticked = providerModels(provider);
  // A provider added a moment ago opens straight into its form.
  const [expanded, setExpanded] = useState(Boolean(onRemove) && ticked.length === 0);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState("");
  // The model id under test, or null — one request at a time per provider.
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const temperature = useAppStore((state) => state.systemSettings.temperature);

  // Every provider but Azure lists its models over the API (Azure names
  // deployments in its portal). The list is a suggestion: ids can always
  // be added by hand, since a provider's /models is often incomplete.
  const canProbeModels = provider.providerType !== "azure";
  // Ticked models first (in the picker's order), then the rest the provider listed.
  const rows = [...ticked, ...(availableModels ?? []).filter((m) => !ticked.includes(m))];

  async function loadModels() {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = (await res.json()) as { models?: string[]; error?: string };
      if (data.error) {
        toast.error(data.error);
        setAvailableModels([]);
        return;
      }
      const models = data.models ?? [];
      if (models.length === 0) {
        toast.error("The provider responded but listed no models");
        setAvailableModels([]);
        return;
      }
      setAvailableModels(models);
      toast.success(`Found ${models.length} model${models.length === 1 ? "" : "s"} — tick the ones you want`);
      if (ticked.length === 0) onChange(toggleModel(provider, models[0], true));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load models");
    } finally {
      setLoadingModels(false);
    }
  }

  function addManualModel() {
    const id = manualModel.trim();
    if (!id) return;
    onChange(toggleModel(provider, id, true));
    setManualModel("");
  }

  // One real request down the path quiz generation uses — proves the key,
  // the model id and the parameters together, not just that a key exists.
  async function testModel(model: string) {
    setTestingModel(model);
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: { ...provider, defaultModel: model },
          temperature: temperature ?? undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; latencyMs?: number; error?: string };
      if (data.ok) {
        toast.success(`${model} answered in ${((data.latencyMs ?? 0) / 1000).toFixed(1)} s`);
      } else {
        toast.error(data.error ?? `${model} answered with no text`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTestingModel(null);
    }
  }

  return (
    <div
      className={`rounded-md border p-4 transition-colors ${
        isActive ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <Switch
          checked={provider.isEnabled}
          onCheckedChange={(c) => onChange({ isEnabled: c })}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{provider.displayName}</span>
            {isActive && <Badge>Active</Badge>}
            {provider.apiKey && <Badge variant="secondary">Key set</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {ticked.length === 0 ? (
              <em>no model set</em>
            ) : ticked.length === 1 ? (
              ticked[0]
            ) : (
              `${ticked.length} models · ${ticked.join(", ")}`
            )}
            {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
          </p>
        </div>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          onClick={onActivate}
          disabled={!provider.isEnabled || ticked.length === 0}
        >
          {isActive ? "Active" : "Activate"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide" : "Edit"}
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t pt-4">
          {onRemove && (
            <div className="space-y-1.5">
              <Label htmlFor={`${provider.id}-name`}>Name</Label>
              <Input
                id={`${provider.id}-name`}
                value={provider.displayName}
                onChange={(e) => onChange({ displayName: e.target.value })}
                placeholder="e.g. University GPU server"
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${provider.id}-key`}>API key</Label>
              <Input
                id={`${provider.id}-key`}
                type="password"
                value={provider.apiKey}
                onChange={(e) => onChange({ apiKey: e.target.value })}
                placeholder={
                  provider.providerType === "ollama" || provider.providerType === "lmstudio"
                    ? "(not required for local)"
                    : "sk-..."
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${provider.id}-base`}>Base URL (optional)</Label>
              <Input
                id={`${provider.id}-base`}
                value={provider.baseUrl ?? ""}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder={
                  provider.providerType === "custom"
                    ? "https://your-endpoint/v1"
                    : provider.providerType === "azure"
                      ? "resource name, or https://<resource>.openai.azure.com"
                      : "(defaults to provider URL)"
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Models in the dropdown</p>
                <p className="text-xs text-muted-foreground">
                  Ticked models each get a line in the header picker.
                  {canProbeModels
                    ? " Load models asks the provider which ones your key can use."
                    : " Azure lists deployments in its portal — add their names below."}
                </p>
              </div>
              {canProbeModels && (
                <Button type="button" variant="outline" size="sm" onClick={loadModels} disabled={loadingModels}>
                  {loadingModels ? "Loading…" : "Load models"}
                </Button>
              )}
            </div>
            {rows.length > 0 && (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {rows.map((m) => {
                  const on = ticked.includes(m);
                  const current = on && m === provider.defaultModel;
                  const boxId = `${provider.id}-model-${m}`;
                  return (
                    <li key={m} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <Checkbox
                        id={boxId}
                        checked={on}
                        onCheckedChange={(c) => onChange(toggleModel(provider, m, c === true))}
                      />
                      <label htmlFor={boxId} className={`flex-1 truncate ${on ? "" : "text-muted-foreground"}`}>
                        {m}
                      </label>
                      {current && <Badge variant="secondary">Current</Badge>}
                      {on && !current && (
                        <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ defaultModel: m })}>
                          Use
                        </Button>
                      )}
                      {on && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => void testModel(m)}
                          disabled={testingModel !== null}
                        >
                          {testingModel === m ? "Testing…" : "Test"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                aria-label={`Add a model id to ${provider.displayName}`}
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addManualModel();
                }}
                placeholder={
                  provider.providerType === "lmstudio"
                    ? "e.g. google/gemma-4-26b-a4b — or click Load models"
                    : provider.providerType === "ollama"
                      ? "e.g. llama3, mistral, qwen2 — or click Load models"
                      : "Add a model id by hand"
                }
              />
              <Button type="button" variant="outline" onClick={addManualModel} disabled={!manualModel.trim()}>
                Add
              </Button>
            </div>
          </div>

          {onRemove && (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
                Remove provider
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Prompt editor — lets the user override any of the registered LLM
 * prompts from `@/lib/prompts`. Iterates over PROMPTS so adding a new
 * prompt id to the registry makes it editable here automatically.
 *
 * The legacy `carmenita.mcq` alias is hidden from the dropdown since
 * it duplicates `carmenita.mcq.document` — editing either one is fine
 * but exposing both is confusing.
 */
/**
 * Account-wide scoring method (app_settings "scoring-method"). Any quiz
 * can override it from the quiz or results screen. Changing it re-scores
 * all finished attempts (except quizzes with their own method), so past
 * results can be compared across methods.
 */
function ScoringCard() {
  const fallback: ScoringMethod =
    process.env.NEXT_PUBLIC_STATIC_BUILD === "1" ? STATIC_DEFAULT_SCORING : SERVER_DEFAULT_SCORING;
  const [method, setMethod] = useState<ScoringMethod | null>(null);
  const url = `/api/settings/${SCORING_SETTING_KEY}`;

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : { value: null }))
      .then((data: { value?: unknown }) => {
        if (!cancelled) setMethod(isScoringMethod(data.value) ? data.value : fallback);
      })
      .catch(() => {
        if (!cancelled) setMethod(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [url, fallback]);

  async function choose(next: ScoringMethod) {
    const previous = method;
    setMethod(next);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      const data = (await res.json()) as { rescored?: number };
      const n = data.rescored ?? 0;
      toast.success(
        `Scoring: ${SCORING_LABELS[next].name}` +
          (n > 0 ? ` — re-scored ${n} past attempt${n === 1 ? "" : "s"}` : ""),
      );
    } catch (err) {
      setMethod(previous);
      toast.error(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring</CardTitle>
        <CardDescription>
          How quiz answers are scored, for all your quizzes. Changing it also re-scores your past
          attempts, so you can switch back and forth to compare. A single quiz can use its own
          method (pick it at the top of the quiz or its results).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {method === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          SCORING_METHODS.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                method === m ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="scoring-method"
                className="mt-1"
                checked={method === m}
                onChange={() => void choose(m)}
              />
              <span>
                <span className="block text-sm font-medium">{SCORING_LABELS[m].name}</span>
                <span className="block text-xs text-muted-foreground">{SCORING_LABELS[m].description}</span>
              </span>
            </label>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PromptEditorCard() {
  const EDITABLE_IDS = Object.values(PROMPTS)
    .map((p) => p.id)
    .filter((id) => id !== "carmenita.mcq"); // hide legacy alias

  const [selectedId, setSelectedId] = useState<string>(EDITABLE_IDS[0]);
  const [value, setValue] = useState("");
  const [modified, setModified] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Overrides live in the database; load the selected one on change.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    fetchPromptOverride(selectedId)
      .then((override) => {
        if (cancelled) return;
        setValue(override ?? PROMPTS[selectedId].defaultValue);
        setModified(override !== null);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Could not load prompt");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const def = PROMPTS[selectedId];
  if (!def) return null;

  const handleSave = async () => {
    try {
      await savePromptOverride(selectedId, value);
      setModified(true);
      toast.success(`Saved override for ${def.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleReset = async () => {
    try {
      await clearPromptOverride(selectedId);
      setValue(def.defaultValue);
      setModified(false);
      toast.success(`Reset ${def.name} to default`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CardTitle>LLM prompts</CardTitle>
            {modified && <Badge variant="secondary">Modified</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="prompt-select" className="text-xs text-muted-foreground">
              Editing
            </Label>
            <Select
              value={selectedId}
              onValueChange={(v) => setSelectedId(v)}
            >
              <SelectTrigger id="prompt-select" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {PROMPTS[id].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <CardDescription>{def.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={18}
          value={value}
          disabled={!loaded}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono text-xs"
        />
        <Separator />
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={!loaded}>Save prompt</Button>
          <Button variant="outline" onClick={handleReset}>
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
