"use client";

import { useState } from "react";
import { Folder, FolderOpen, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SetNameFields, type SetSummary } from "@/components/SetNameFields";

/** What the bank is currently narrowed to. */
export type SetScope =
  | { kind: "all" }
  | { kind: "folder"; folder: string }
  | { kind: "set"; id: string };

interface SetsPanelProps {
  sets: SetSummary[];
  scope: SetScope;
  onScopeChange: (scope: SetScope) => void;
  /** Called after a rename / move / delete so the page can reload. */
  onChanged: () => void;
}

/**
 * Folder → set browser on the bank page. Click a folder or set to
 * narrow the question list; each set can be renamed, moved to another
 * folder, or deleted together with all its questions.
 */
export function SetsPanel({ sets, scope, onScopeChange, onChanged }: SetsPanelProps) {
  const [editing, setEditing] = useState<SetSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editFolder, setEditFolder] = useState("");
  const [saving, setSaving] = useState(false);

  const groups = new Map<string | null, SetSummary[]>();
  sets.forEach((s) => groups.set(s.folder, [...(groups.get(s.folder) ?? []), s]));

  function openEdit(s: SetSummary) {
    setEditing(s);
    setEditName(s.name);
    setEditFolder(s.folder ?? "");
  }

  async function handleSave() {
    if (!editing) return;
    if (!editName.trim()) {
      toast.error("Set name must not be empty");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/bank/sets/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), folder: editFolder.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      toast.success("Set updated");
      setEditing(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s: SetSummary) {
    const ok = confirm(
      `Delete the set "${s.name}" and all ${s.questionCount} of its questions?\n\n` +
        "They will be removed from every quiz that uses them. This cannot be undone.",
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/bank/sets/${s.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      toast.success(`Deleted "${s.name}" (${data.questionsDeleted} questions)`);
      if (scope.kind === "set" && scope.id === s.id) onScopeChange({ kind: "all" });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const isActive = (candidate: SetScope) =>
    JSON.stringify(candidate) === JSON.stringify(scope);
  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
      active ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted"
    }`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Sets &amp; folders
        </CardTitle>
        <CardDescription>
          Every import is a named set. Click one to show only its questions; use ⋯ to rename,
          move to a folder, or delete it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <button type="button" className={rowClass(isActive({ kind: "all" }))} onClick={() => onScopeChange({ kind: "all" })}>
          <Layers className="h-4 w-4 text-muted-foreground" />
          All questions
        </button>
        {sets.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            No sets yet. Imports you name will appear here.
          </p>
        )}
        {[...groups.entries()].map(([folder, folderSets]) => (
          <div key={folder ?? "__none__"} className="space-y-0.5">
            {folder !== null ? (
              <button
                type="button"
                className={rowClass(isActive({ kind: "folder", folder }))}
                onClick={() => onScopeChange({ kind: "folder", folder })}
              >
                {isActive({ kind: "folder", folder }) ? (
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Folder className="h-4 w-4 text-muted-foreground" />
                )}
                {folder}
                <span className="ml-auto text-xs text-muted-foreground">
                  {folderSets.reduce((n, s) => n + s.questionCount, 0)}
                </span>
              </button>
            ) : (
              groups.size > 1 && (
                <p className="px-2 pt-2 text-xs uppercase tracking-wide text-muted-foreground">No folder</p>
              )
            )}
            {folderSets.map((s) => (
              <div key={s.id} className={`flex items-center ${folder !== null ? "pl-5" : ""}`}>
                <button
                  type="button"
                  className={rowClass(isActive({ kind: "set", id: s.id }))}
                  onClick={() => onScopeChange({ kind: "set", id: s.id })}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{s.questionCount}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                      Rename / move to folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => void handleDelete(s)}>
                      <Trash2 className="h-4 w-4" />
                      Delete set and its questions
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ))}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit set</DialogTitle>
            <DialogDescription>
              Rename the set or file it in a folder. Clear the folder to remove it from one.
            </DialogDescription>
          </DialogHeader>
          <SetNameFields
            name={editName}
            folder={editFolder}
            onNameChange={setEditName}
            onFolderChange={setEditFolder}
            excludeSetId={editing?.id}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !editName.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
