"use client";

import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

// One /api/auth/me request per page load, shared by every caller
// (header, sidebar, Users page). Resolves to null when signed out or in
// the static build, which has no accounts.
let mePromise: Promise<CurrentUser | null> | null = null;

function fetchMe(): Promise<CurrentUser | null> {
  mePromise ??= fetch("/api/auth/me")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { user?: CurrentUser } | null) => data?.user ?? null)
    .catch(() => null);
  return mePromise;
}

/** The signed-in user, or null (loading, signed out, or static build). */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return user;
}
