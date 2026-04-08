"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  PROMPTS,
  getPrompt,
  setPromptOverride,
  clearPromptOverride,
  hasPromptOverride,
} from "@/lib/prompts";
import type { ProviderConfig } from "@/types";

/**
 * Settings page. Lets the user:
 *  - Configure each of the 10 LLM providers (API key, base URL, model)
 *  - Toggle each provider enabled/disabled
 *  - Select the ACTIVE provider (the one used by /upload)
 *  - Edit the MCQ generation prompt (saved to localStorage)
 *  - Adjust system settings (temperature, autoRetry)
 */
export default function SettingsPage() {
  const {
    providers,
    activeProviderId,
    systemSettings,
    setProviderConfig,
    setActiveProvider,
    setSystemSettings,
  } = useAppStore();

  const providerList = Object.values(providers);

  return (
    // suppressHydrationWarning: password-manager extensions flag the API
    // key inputs here and inject data attributes. Element-scoped, does
    // not cascade — children still warn on legitimate mismatches.
    <div className="mx-auto max-w-4xl space-y-6" suppressHydrationWarning>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure your LLM providers and the quiz-generation prompt. All data
          stays in your browser — API keys are never sent anywhere except directly
          to the provider you&apos;re calling.
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
            Click a provider to configure it. The highlighted one is active.
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
            />
          ))}
        </CardContent>
      </Card>

      <PromptEditorCard />
    </div>
  );
}

function ProviderRow({
  provider,
  isActive,
  onActivate,
  onChange,
}: {
  provider: ProviderConfig;
  isActive: boolean;
  onActivate: () => void;
  onChange: (patch: Partial<ProviderConfig>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  // Local/custom providers don't have well-known model ids — the user's
  // actual list depends on what they've downloaded. We let them probe
  // the provider's /models endpoint to populate a real dropdown.
  const canProbeModels =
    provider.providerType === "ollama" ||
    provider.providerType === "lmstudio" ||
    provider.providerType === "custom";

  async function loadModels() {
    if (!provider.baseUrl) {
      toast.error("Set a base URL first");
      return;
    }
    setLoadingModels(true);
    try {
      const res = await fetch("/api/local-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        setAvailableModels([]);
        return;
      }
      if (!Array.isArray(data.models) || data.models.length === 0) {
        toast.error("The endpoint responded but had no models");
        setAvailableModels([]);
        return;
      }
      setAvailableModels(data.models);
      toast.success(`Found ${data.models.length} model${data.models.length === 1 ? "" : "s"}`);
      // If the current defaultModel isn't in the list, auto-select the first one
      if (!provider.defaultModel || !data.models.includes(provider.defaultModel)) {
        onChange({ defaultModel: data.models[0] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setLoadingModels(false);
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
            {provider.defaultModel || <em>no model set</em>}
            {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
          </p>
        </div>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          onClick={onActivate}
          disabled={!provider.isEnabled}
        >
          {isActive ? "Active" : "Activate"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide" : "Edit"}
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <div className="grid grid-cols-2 gap-3">
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
              <div className="flex items-center justify-between">
                <Label htmlFor={`${provider.id}-model`}>Default model</Label>
                {canProbeModels && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={loadModels}
                    disabled={loadingModels || !provider.baseUrl}
                  >
                    {loadingModels ? "Loading…" : "Load models"}
                  </Button>
                )}
              </div>
              {canProbeModels && availableModels && availableModels.length > 0 ? (
                <select
                  id={`${provider.id}-model`}
                  value={provider.defaultModel}
                  onChange={(e) => onChange({ defaultModel: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {!availableModels.includes(provider.defaultModel) && provider.defaultModel && (
                    <option value={provider.defaultModel}>
                      {provider.defaultModel} (custom)
                    </option>
                  )}
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${provider.id}-model`}
                  value={provider.defaultModel}
                  onChange={(e) => onChange({ defaultModel: e.target.value })}
                  placeholder={
                    provider.providerType === "lmstudio"
                      ? "e.g. google/gemma-4-26b-a4b — click Load models"
                      : provider.providerType === "ollama"
                        ? "e.g. llama3, mistral, qwen2 — click Load models"
                        : "gpt-4o"
                  }
                />
              )}
            </div>
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
                  : "(defaults to provider URL)"
              }
            />
          </div>
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
function PromptEditorCard() {
  const EDITABLE_IDS = Object.values(PROMPTS)
    .map((p) => p.id)
    .filter((id) => id !== "carmenita.mcq"); // hide legacy alias

  const [selectedId, setSelectedId] = useState<string>(EDITABLE_IDS[0]);
  const [value, setValue] = useState("");
  const [modified, setModified] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage AFTER mount to avoid SSR mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setValue(getPrompt(selectedId));
    setModified(hasPromptOverride(selectedId));
  }, [selectedId]);

  if (!mounted) return null;

  const def = PROMPTS[selectedId];
  if (!def) return null;

  const handleSave = () => {
    setPromptOverride(selectedId, value);
    setModified(true);
    toast.success(`Saved override for ${def.name}`);
  };

  const handleReset = () => {
    clearPromptOverride(selectedId);
    setValue(def.defaultValue);
    setModified(false);
    toast.success(`Reset ${def.name} to default`);
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
                    {hasPromptOverride(id) ? " (modified)" : ""}
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
          onChange={(e) => setValue(e.target.value)}
          className="font-mono text-xs"
        />
        <Separator />
        <div className="flex items-center gap-2">
          <Button onClick={handleSave}>Save prompt</Button>
          <Button variant="outline" onClick={handleReset}>
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
