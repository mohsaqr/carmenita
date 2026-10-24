import { describe, it, expect } from "vitest";
import {
  addProvider,
  chatProvider,
  isBuiltInProvider,
  pickerGroups,
  providerModels,
  removeProvider,
  toggleModel,
  useAppStore,
} from "@/lib/store";

const builtIns = useAppStore.getState().providers;

describe("addProvider", () => {
  it("adds a second custom URL under a fresh id with the custom defaults", () => {
    const { providers, id } = addProvider(builtIns, "custom");
    expect(id).toBe("custom-2");
    expect(providers[id]).toMatchObject({
      id: "custom-2",
      providerType: "custom",
      displayName: "Custom OpenAI-compatible 2",
      defaultModel: "",
      isEnabled: true,
    });
    expect(Object.keys(providers)).toHaveLength(Object.keys(builtIns).length + 1);
  });

  it("never reuses an id, so repeated adds all survive", () => {
    const first = addProvider(builtIns, "custom");
    const second = addProvider(first.providers, "custom");
    expect(second.id).toBe("custom-3");
    expect(second.providers["custom-2"]).toBeDefined();
  });

  it("keeps the type's base URL and local key for a second Ollama model", () => {
    const { providers, id } = addProvider(builtIns, "ollama");
    expect(providers[id].baseUrl).toBe("http://localhost:11434/v1");
    expect(providers[id].apiKey).toBe("ollama");
  });

  it("does not touch the input", () => {
    const before = JSON.stringify(builtIns);
    addProvider(builtIns, "openai");
    expect(JSON.stringify(builtIns)).toBe(before);
  });
});

describe("Dynasite preset", () => {
  it("ships as a built-in custom provider with its URL filled in", () => {
    expect(builtIns.dynasite).toMatchObject({
      providerType: "custom",
      displayName: "Dynasite",
      baseUrl: "https://api.dynasite.org/v1",
      isEnabled: true,
    });
    expect(isBuiltInProvider("dynasite")).toBe(true);
  });

  it("does not become the template for an added custom URL", () => {
    const { providers, id } = addProvider(builtIns, "custom");
    expect(providers[id].baseUrl).toBe("");
  });
});

describe("removeProvider", () => {
  it("removes an added provider and clears it as active", () => {
    const { providers, id } = addProvider(builtIns, "custom");
    const out = removeProvider(providers, id, id);
    expect(out.providers[id]).toBeUndefined();
    expect(out.activeProviderId).toBeNull();
  });

  it("keeps another active provider", () => {
    const { providers, id } = addProvider(builtIns, "custom");
    expect(removeProvider(providers, "openai", id).activeProviderId).toBe("openai");
  });

  it("refuses to remove a built-in provider", () => {
    const out = removeProvider(builtIns, "openai", "openai");
    expect(out.providers.openai).toBeDefined();
    expect(out.activeProviderId).toBe("openai");
    expect(isBuiltInProvider("openai")).toBe(true);
    expect(isBuiltInProvider("custom-2")).toBe(false);
  });
});

describe("providerModels", () => {
  it("treats a saved setup without a list as its one current model", () => {
    expect(providerModels(builtIns.anthropic)).toEqual(["claude-sonnet-5-5"]);
  });

  it("keeps the ticked order, adds a current model not in the list, drops blanks and repeats", () => {
    const p = { ...builtIns.dynasite, models: ["b", "a", " ", "b"], defaultModel: "c" };
    expect(providerModels(p)).toEqual(["b", "a", "c"]);
  });

  it("is empty for a provider with no model at all", () => {
    expect(providerModels(builtIns.dynasite)).toEqual([]);
  });
});

describe("toggleModel", () => {
  const empty = builtIns.dynasite;

  it("ticking the first model makes it current", () => {
    expect(toggleModel(empty, "qwen3-32b", true)).toEqual({ models: ["qwen3-32b"], defaultModel: "qwen3-32b" });
  });

  it("ticking another keeps the current one", () => {
    const one = { ...empty, ...toggleModel(empty, "a", true) };
    expect(toggleModel(one, "b", true)).toEqual({ models: ["a", "b"], defaultModel: "a" });
  });

  it("unticking the current model moves to the next ticked, then to none", () => {
    const two = { ...empty, models: ["a", "b"], defaultModel: "a" };
    const after = { ...two, ...toggleModel(two, "a", false) };
    expect(after).toMatchObject({ models: ["b"], defaultModel: "b" });
    expect(toggleModel(after, "b", false)).toEqual({ models: [], defaultModel: "" });
  });

  it("ticking twice is idempotent and trims the id", () => {
    const one = { ...empty, ...toggleModel(empty, " a ", true) };
    expect(toggleModel(one, "a", true)).toEqual({ models: ["a"], defaultModel: "a" });
  });
});

describe("pickerGroups", () => {
  it("lists one group per enabled provider that offers a model, one entry per model", () => {
    const providers = {
      ...builtIns,
      dynasite: { ...builtIns.dynasite, models: ["qwen3-32b", "llama-4-70b"], defaultModel: "qwen3-32b" },
    };
    const groups = pickerGroups(providers);
    expect(groups.find((g) => g.providerId === "dynasite")).toEqual({
      providerId: "dynasite",
      displayName: "Dynasite",
      models: ["qwen3-32b", "llama-4-70b"],
    });
    const ids = groups.map((g) => g.providerId);
    expect(ids).toContain("openai");
    expect(ids).not.toContain("custom"); // disabled by default
    expect(ids).not.toContain("lmstudio"); // disabled, no model
    expect(groups.every((g) => g.models.length > 0)).toBe(true);
  });

  it("leaves out an enabled provider with no model", () => {
    const { providers, id } = addProvider(builtIns, "custom");
    expect(pickerGroups(providers).map((g) => g.providerId)).not.toContain(id);
  });
});

describe("store actions", () => {
  it("selectModel makes the provider active and runs the picked model", () => {
    const store = useAppStore.getState();
    store.setProviderConfig("dynasite", { models: ["a", "b"], defaultModel: "a" });
    useAppStore.getState().selectModel("dynasite", "b");
    const state = useAppStore.getState();
    expect(state.activeProviderId).toBe("dynasite");
    expect(state.providers.dynasite.defaultModel).toBe("b");
    expect(state.providers.dynasite.models).toEqual(["a", "b"]);
    useAppStore.getState().selectModel("no-such-provider", "x");
    expect(useAppStore.getState().activeProviderId).toBe("dynasite");
  });

  it("add then remove through the store round-trips", () => {
    const store = useAppStore.getState();
    const id = store.addProvider("custom");
    store.setActiveProvider(id);
    expect(useAppStore.getState().providers[id]).toBeDefined();
    useAppStore.getState().removeProvider(id);
    expect(useAppStore.getState().providers[id]).toBeUndefined();
    expect(useAppStore.getState().activeProviderId).toBeNull();
  });
});

describe("chatProvider (the Chat page's model)", () => {
  const withDynasite = {
    ...builtIns,
    dynasite: { ...builtIns.dynasite, apiKey: "sk-d", defaultModel: "gpt-x", models: ["gpt-x", "claude-y"] },
    openai: { ...builtIns.openai, apiKey: "sk-o", defaultModel: "gpt-4.1-mini" },
  };

  it("defaults to Dynasite once it has a key and a model, whatever the header picked", () => {
    const p = chatProvider(withDynasite, null, "openai");
    expect(p?.id).toBe("dynasite");
    expect(p?.defaultModel).toBe("gpt-x");
  });

  it("falls back to the active provider while Dynasite has no key", () => {
    expect(builtIns.dynasite.apiKey).toBe("");
    const providers = { ...withDynasite, dynasite: builtIns.dynasite };
    expect(chatProvider(providers, null, "openai")?.id).toBe("openai");
    expect(chatProvider(providers, null, null)).toBeNull();
  });

  it("uses the chat's own pick, without changing the stored provider", () => {
    const p = chatProvider(withDynasite, { providerId: "dynasite", model: "claude-y" }, "openai");
    expect(p?.defaultModel).toBe("claude-y");
    expect(withDynasite.dynasite.defaultModel).toBe("gpt-x");
    expect(chatProvider(withDynasite, { providerId: "openai", model: "gpt-4.1-mini" }, null)?.id).toBe("openai");
  });

  it("ignores a pick that is no longer offered (unticked model, disabled or removed provider)", () => {
    expect(chatProvider(withDynasite, { providerId: "dynasite", model: "gone" }, null)?.defaultModel).toBe("gpt-x");
    expect(chatProvider(withDynasite, { providerId: "custom-9", model: "m" }, null)?.id).toBe("dynasite");
    const off = { ...withDynasite, openai: { ...withDynasite.openai, isEnabled: false } };
    expect(chatProvider(off, { providerId: "openai", model: "gpt-4.1-mini" }, null)?.id).toBe("dynasite");
  });

});
