"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PASSWORD_HASH,
  isUnlocked,
  markUnlocked,
  verifyPassword,
} from "@/lib/password-gate";

/**
 * Gates the entire app behind a password check. Also delays the sql.js
 * DB download until unlock, so unauthorized visitors never pull
 * `/carmenita.db`.
 *
 * Uses `useSyncExternalStore` to read the unlock flag from
 * `localStorage` — React handles the SSR → client transition without
 * a hydration warning, and we avoid the `setState-in-effect` lint rule
 * that fires for the equivalent `useEffect` pattern.
 */

// Module-level listener set so `markUnlocked()` can notify mounted
// gates to re-read the store. The `storage` event only fires in OTHER
// tabs, so we need our own same-tab notifier.
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): boolean {
  return isUnlocked();
}

function getServerSnapshot(): boolean {
  // On the server (and during static export at build time) we can't
  // read localStorage. Default to "unlocked" when no gate is configured
  // so the build-time HTML renders the real app; default to "locked"
  // when a gate IS configured so unauthorized visitors see the lock
  // screen on first paint.
  return !PASSWORD_HASH;
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const unlocked = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const ok = await verifyPassword(input);
    setPending(false);
    if (!ok) {
      setError("Incorrect password");
      setInput("");
      return;
    }
    markUnlocked();
    listeners.forEach((l) => l());
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Carmenita</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          This site is password-protected. Enter the password to continue.
        </p>
        <div className="space-y-2">
          <Label htmlFor="carmenita-password">Password</Label>
          <Input
            id="carmenita-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={pending || input.length === 0}
          className="w-full"
        >
          {pending ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
