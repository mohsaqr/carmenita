"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface UserRow {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  questionCount: number;
}

const MIN_PASSWORD = 6;

/**
 * Admin-only account management: create accounts and reset passwords.
 * Every account gets its own private bank; nothing here touches bank
 * content. The API enforces admin rights — this page just hides itself
 * for everyone else.
 */
export default function UsersPage() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      setForbidden(true);
      return;
    }
    if (!res.ok) {
      toast.error(`Could not load users (${res.status})`);
      return;
    }
    const data = (await res.json()) as { users: UserRow[] };
    setUsers(data.users);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, isAdmin: makeAdmin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Could not create user (${res.status})`);
      toast.success(`Created ${data.user.isAdmin ? "admin" : "user"} "${data.user.username}"`);
      setUsername("");
      setPassword("");
      setMakeAdmin(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleReset() {
    if (!resetting || resetBusy) return;
    setResetBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${resetting.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Could not reset password (${res.status})`);
      toast.success(`New password set for "${resetting.username}". They were signed out everywhere.`);
      setResetting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setResetBusy(false);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Only admins can manage accounts.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" suppressHydrationWarning>
      <header>
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6" />
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Create accounts and reset passwords. Each person gets their own private bank and can
          send copies of their sets to others.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            New account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4" autoComplete="off">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-username">Username</Label>
                <Input
                  id="new-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  disabled={creating}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Password</Label>
                <Input
                  id="new-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={creating}
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD} characters. Shown so you can pass it on.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="new-admin"
                checked={makeAdmin}
                onCheckedChange={(v) => setMakeAdmin(v === true)}
                disabled={creating}
              />
              <Label htmlFor="new-admin" className="font-normal">
                Admin (can also create accounts and reset passwords)
              </Label>
            </div>
            <Button
              type="submit"
              disabled={creating || !username.trim() || password.length < MIN_PASSWORD}
            >
              {creating ? "Creating…" : "Create account"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>{users ? `${users.length} account${users.length === 1 ? "" : "s"}` : "Loading…"}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {(users ?? []).map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{u.username}</span>
                  {u.isAdmin && (
                    <Badge variant="secondary" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      admin
                    </Badge>
                  )}
                  {me?.id === u.id && <Badge variant="outline">you</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {u.questionCount} question{u.questionCount === 1 ? "" : "s"} · created{" "}
                  {new Date(u.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResetting(u);
                  setNewPassword("");
                }}
              >
                <KeyRound className="h-4 w-4" />
                Reset password
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {resetting
                ? `Set a new password for "${resetting.username}". They will be signed out on every device.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              disabled={resetBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)} disabled={resetBusy}>
              Cancel
            </Button>
            <Button onClick={handleReset} disabled={resetBusy || newPassword.length < MIN_PASSWORD}>
              {resetBusy ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
