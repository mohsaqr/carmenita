"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cpu } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import { pickerGroups, useAppStore, type ModelSelection } from "@/lib/store";

const MANAGE = "__manage__";
// Option values pair a provider id with a model id. Provider ids are
// `[a-z]+(-n)?`, so the first separator always splits them correctly.
const SEP = "::";

/**
 * Header dropdown that switches the active provider + model from any
 * page: one line per ticked model, grouped by provider. Every LLM call
 * (generate, topic, explain, re-tag, variations) reads the active
 * provider's `defaultModel`, so the pick applies to all of them.
 *
 * With `selection` + `onSelect` it picks for one purpose instead (the Chat
 * page's own model) and leaves the active provider alone.
 */
export function ModelPicker({
  selection,
  onSelect,
  label = "Model used for generation",
}: {
  selection?: ModelSelection | null;
  onSelect?: (providerId: string, model: string) => void;
  label?: string;
} = {}) {
  const router = useRouter();
  const providers = useAppStore((s) => s.providers);
  const storeActiveId = useAppStore((s) => s.activeProviderId);
  const selectModel = useAppStore((s) => s.selectModel);
  const groups = pickerGroups(providers);
  const choose = onSelect ?? selectModel;
  const activeProviderId = onSelect ? selection?.providerId ?? null : storeActiveId;

  if (groups.length === 0) {
    return (
      <Link href="/settings" className="text-sm text-muted-foreground underline">
        Set up a model
      </Link>
    );
  }

  const active = groups.find((g) => g.providerId === activeProviderId);
  const activeModel = active ? (onSelect ? selection?.model ?? "" : providers[active.providerId].defaultModel) : "";
  const value = active && activeModel ? `${active.providerId}${SEP}${activeModel}` : "";

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === MANAGE) {
          router.push("/settings");
          return;
        }
        const at = v.indexOf(SEP);
        choose(v.slice(0, at), v.slice(at + SEP.length));
      }}
    >
      <SelectTrigger size="sm" className="max-w-[18rem]" aria-label={label}>
        <Cpu className="h-4 w-4" />
        {active && activeModel ? (
          <span className="truncate">
            <span className="font-medium">{active.displayName}</span>
            <span className="text-muted-foreground"> · {activeModel}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Choose a model</span>
        )}
      </SelectTrigger>
      {/* popper: open under the button. The default item-aligned mode
          positions against a <SelectValue>, which this custom trigger
          doesn't render — the list then lands at the bottom of the page. */}
      <SelectContent position="popper" align="end" className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
        {groups.map((g, i) => (
          <Fragment key={g.providerId}>
            {i > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>{g.displayName}</SelectLabel>
              {g.models.map((m) => (
                <SelectItem key={m} value={`${g.providerId}${SEP}${m}`}>
                  {m}
                </SelectItem>
              ))}
            </SelectGroup>
          </Fragment>
        ))}
        <SelectSeparator />
        <SelectItem value={MANAGE}>Manage models…</SelectItem>
      </SelectContent>
    </Select>
  );
}
