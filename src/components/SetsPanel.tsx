"use client";

import { Fragment, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Layers,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SetNameFields, type SetSummary } from "@/components/SetNameFields";
import { groupSetsByFolder } from "@/lib/set-groups";

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
 * folder, archived (hidden from the bank, restorable) or deleted
 * together with all its questions.
 */
export function SetsPanel({ sets, scope, onScopeChange, onChanged }: SetsPanelProps) {
  const [editing, setEditing] = useState<SetSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editFolder, setEditFolder] = useState("");
  const [saving, setSaving] = useState(false);
  // Other accounts to send copies to. null = not available (static
  // build has no accounts) → the "Send a copy" action is hidden.
  const [otherUsers, setOtherUsers] = useState<string[] | null>(null);
  const [sending, setSending] = useState<SetSummary | null>(null);
  const [recipient, setRecipient] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Archived folders open one at a time on demand, so a large archived
  // collection (e.g. a benchmark bank) stays a single line per folder.
  const [openArchivedFolders, setOpenArchivedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { users?: string[] } | null) => {
        if (!cancelled) setOtherUsers(data?.users ?? null);
      })
      .catch(() => {
        // No accounts endpoint (static build) — sending stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Archived sets leave the main list; they live in the collapsible
  // "Archived" section below, where they can be opened or restored.
  const liveSets = sets.filter((s) => !s.archived);
  const archivedSets = sets.filter((s) => s.archived);
  const groups = groupSetsByFolder(liveSets);
  const archivedGroups = groupSetsByFolder(archivedSets);

  function toggleArchivedFolder(folder: string) {
    setOpenArchivedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

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

  function openSend(s: SetSummary) {
    setSending(s);
    setRecipient("");
  }

  async function handleSend() {
    if (!sending || !recipient) return;
    setSendBusy(true);
    try {
      const res = await fetch(`/api/bank/sets/${sending.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUsername: recipient }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
      toast.success(`Sent a copy of "${sending.name}" (${data.questionsCopied} questions) to ${data.sentTo}`);
      setSending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

  /**
   * Archive or restore each set. Settles every request (a folder can hold
   * many sets) and returns the ids that did change, so a partial failure
   * is reported and undoable instead of being shown as a total failure.
   */
  async function patchArchived(ids: string[], archived: boolean): Promise<{ done: string[]; failed: number }> {
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/bank/sets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        }).then((res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          return id;
        }),
      ),
    );
    const done = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    return { done, failed: ids.length - done.length };
  }

  async function handleArchive(targets: SetSummary[], archived: boolean, label: string) {
    const ids = targets.map((t) => t.id);
    const verb = archived ? "Archive" : "Restore";
    const { done, failed } = await patchArchived(ids, archived);
    // Always reload: some sets may have changed even when others failed.
    if (archived && scope.kind === "set" && done.includes(scope.id)) onScopeChange({ kind: "all" });
    onChanged();
    if (done.length === 0) {
      toast.error(`${verb} failed for ${label}. Nothing was changed.`);
      return;
    }
    const undo = {
      label: "Undo",
      onClick: () => {
        void patchArchived(done, !archived).then((r) => {
          onChanged();
          if (r.failed) toast.error(`Undo failed for ${r.failed} of ${done.length} sets`);
        });
      },
    };
    if (failed > 0) {
      toast.error(`${verb}d ${done.length} of ${ids.length} sets in ${label}; ${failed} failed. Try again for the rest.`, {
        action: undo,
      });
    } else {
      toast.success(archived ? `Archived ${label}` : `Restored ${label}`, { action: undo });
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

  function renderSetRow(s: SetSummary, indent: boolean) {
    return (
      <div key={s.id} className={`flex items-center ${indent ? "pl-5" : ""} ${s.archived ? "opacity-70" : ""}`}>
        <button
          type="button"
          className={rowClass(isActive({ kind: "set", id: s.id }))}
          onClick={() => onScopeChange({ kind: "set", id: s.id })}
        >
          <span className="truncate">{s.name}</span>
          {s.receivedFrom && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              from {s.receivedFrom}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{s.questionCount}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={s.archived ? `Restore ${s.name} from the archive` : `Archive ${s.name}`}
          title={s.archived ? "Restore from archive" : "Archive (hide from the bank)"}
          onClick={() => void handleArchive([s], !s.archived, `"${s.name}"`)}
        >
          {s.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </Button>
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
            <DropdownMenuItem onClick={() => void handleArchive([s], !s.archived, `"${s.name}"`)}>
              {s.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {s.archived ? "Restore from archive" : "Archive (hide from the bank)"}
            </DropdownMenuItem>
            {otherUsers !== null && (
              <DropdownMenuItem onClick={() => openSend(s)} disabled={otherUsers.length === 0}>
                <Send className="h-4 w-4" />
                {otherUsers.length === 0 ? "Send a copy (no other users yet)" : "Send a copy to…"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void handleDelete(s)}>
              <Trash2 className="h-4 w-4" />
              Delete set and its questions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Sets &amp; folders
        </CardTitle>
        <CardDescription>
          Every import is a named set. Click one to show only its questions; use ⋯ to rename,
          move to a folder, archive (hide it without deleting) or delete it.
        </CardDescription>
        <p className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">
          <Archive className="h-4 w-4 shrink-0" />
          Too crowded? Use the archive icon beside a set, or Archive on a folder, to tuck away what
          you are not using. Nothing is deleted, and archived sets stay under Archived below.
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        <button type="button" className={rowClass(isActive({ kind: "all" }))} onClick={() => onScopeChange({ kind: "all" })}>
          <Layers className="h-4 w-4 text-muted-foreground" />
          All questions
        </button>
        {liveSets.length === 0 && archivedSets.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            No sets yet. Imports you name will appear here.
          </p>
        )}
        {groups.map(({ folder, sets: folderSets, questionCount }) => (
          <div key={folder ?? "__none__"} className="space-y-0.5">
            {folder !== null ? (
              <div className="flex items-center">
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
                  <span className="ml-auto text-xs text-muted-foreground">{questionCount}</span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Archive all ${folderSets.length} sets in ${folder}`}
                  title={`Archive all ${folderSets.length} sets in this folder`}
                  onClick={() => void handleArchive(folderSets, true, `${folderSets.length} sets in "${folder}"`)}
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </Button>
              </div>
            ) : (
              groups.length > 1 && (
                <p className="px-2 pt-2 text-xs uppercase tracking-wide text-muted-foreground">No folder</p>
              )
            )}
            {folderSets.map((s) => renderSetRow(s, folder !== null))}
          </div>
        ))}
        {archivedSets.length > 0 && (
          <div className="space-y-0.5 pt-2">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
            >
              {showArchived ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Archive className="h-4 w-4" />
              Archived
              <span className="ml-auto text-xs">
                {archivedSets.length} {archivedSets.length === 1 ? "set" : "sets"}
              </span>
            </button>
            {showArchived &&
              archivedGroups.map(({ folder, sets: folderSets, questionCount }) =>
                folder === null ? (
                  <Fragment key="__none__">{folderSets.map((s) => renderSetRow(s, true))}</Fragment>
                ) : (
                  <div key={folder} className="space-y-0.5 pl-5">
                    <div className="flex items-center opacity-70">
                      <button
                        type="button"
                        className={rowClass(false)}
                        onClick={() => toggleArchivedFolder(folder)}
                        aria-expanded={openArchivedFolders.has(folder)}
                      >
                        {openArchivedFolders.has(folder) ? (
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Folder className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="truncate">{folder}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {folderSets.length} {folderSets.length === 1 ? "set" : "sets"} · {questionCount}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Restore all ${folderSets.length} sets in ${folder}`}
                        title={`Restore all ${folderSets.length} sets in this folder`}
                        onClick={() => void handleArchive(folderSets, false, `${folderSets.length} sets in "${folder}"`)}
                      >
                        <ArchiveRestore className="h-4 w-4" />
                        Restore
                      </Button>
                    </div>
                    {openArchivedFolders.has(folder) && folderSets.map((s) => renderSetRow(s, true))}
                  </div>
                ),
              )}
          </div>
        )}
      </CardContent>

      <Dialog open={sending !== null} onOpenChange={(open) => !open && setSending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a copy</DialogTitle>
            <DialogDescription>
              {sending
                ? `"${sending.name}" (${sending.questionCount} questions) will be copied into their bank. They get their own copy — your set is not changed or shared.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="send-recipient">Send to</Label>
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger id="send-recipient" className="w-full">
                <SelectValue placeholder="Choose a user" />
              </SelectTrigger>
              <SelectContent>
                {(otherUsers ?? []).map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSending(null)} disabled={sendBusy}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sendBusy || !recipient}>
              <Send className="h-4 w-4" />
              {sendBusy ? "Sending…" : "Send copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
