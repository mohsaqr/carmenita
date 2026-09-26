"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, LogOut, Menu, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  onMenuClick: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  // Null when signed out or in the static build (no /api/auth there).
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.user?.username) setUsername(data.user.username);
      })
      .catch(() => {
        // Network failure: leave the user badge hidden; the proxy
        // still enforces auth on the next navigation.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b px-4 sm:px-6 lg:px-8">
      {/* Mobile: logo + hamburger */}
      <button
        type="button"
        className="md:hidden"
        onClick={onMenuClick}
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Link
        href="/"
        className="flex items-center gap-2 font-semibold md:hidden"
      >
        <GraduationCap className="h-5 w-5" />
        <span>Carmenita</span>
      </Link>
      {username && (
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <User className="h-4 w-4" />
            {username}
          </span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      )}
    </header>
  );
}
