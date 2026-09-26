"use client";

import { useEffect, useId, useState } from "react";
import { Folder, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SetSummary {
  id: string;
  name: string;
  folder: string | null;
  /** Sender's username when this set arrived as a copy (server build only). */
  receivedFrom?: string | null;
  createdAt: string;
  questionCount: number;
}

interface SetNameFieldsProps {
  name: string;
  folder: string;
  onNameChange: (name: string) => void;
  onFolderChange: (folder: string) => void;
  /** When editing an existing set, ignore it in the "adds to existing set" hint. */
  excludeSetId?: string;
}

/**
 * "Set name" (required) + "Folder" (optional) inputs shown on every
 * import. Both offer autocomplete from existing sets/folders, so typing
 * an existing set name in the same folder adds to that set.
 */
export function SetNameFields({
  name,
  folder,
  onNameChange,
  onFolderChange,
  excludeSetId,
}: SetNameFieldsProps) {
  const uid = useId();
  const [sets, setSets] = useState<SetSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/bank/sets")
      .then((res) => (res.ok ? res.json() : { sets: [] }))
      .then((data: { sets?: SetSummary[] }) => {
        if (!cancelled) setSets(data.sets ?? []);
      })
      .catch(() => {
        // Suggestions are a convenience; the inputs still work without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const folders = [...new Set(sets.map((s) => s.folder).filter((f): f is string => !!f))];
  const setNames = [...new Set(sets.map((s) => s.name))];
  const existing = sets.find(
    (s) =>
      s.id !== excludeSetId &&
      s.name.toLowerCase() === name.trim().toLowerCase() &&
      (s.folder ?? "").toLowerCase() === folder.trim().toLowerCase(),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-name`} className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          Set name <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`${uid}-name`}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Chapter 3 — Inflammation"
          list={`${uid}-names`}
          required
          aria-required
        />
        <datalist id={`${uid}-names`}>
          {setNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          {existing
            ? excludeSetId
              ? "Another set in this folder already has this name."
              : `Adds to the existing set (${existing.questionCount} questions).`
            : "Required: names this batch so you can find, move or delete it later."}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-folder`} className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5" />
          Folder (optional)
        </Label>
        <Input
          id={`${uid}-folder`}
          value={folder}
          onChange={(e) => onFolderChange(e.target.value)}
          placeholder="e.g. pathology"
          list={`${uid}-folders`}
        />
        <datalist id={`${uid}-folders`}>
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Group related sets together, e.g. all pathology sets.
        </p>
      </div>
    </div>
  );
}
