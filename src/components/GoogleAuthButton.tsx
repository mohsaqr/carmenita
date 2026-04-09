"use client";

import { useSyncExternalStore } from "react";
import {
  isGoogleAuthConfigured,
  getAuthState,
  subscribeAuth,
  loginWithGoogle,
  logout,
  type AuthState,
} from "@/lib/google-auth";
import {
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from "@/lib/google-drive";
import { LogIn, LogOut, Cloud, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function useAuth(): AuthState | null {
  return useSyncExternalStore(
    subscribeAuth,
    getAuthState,
    () => null, // server snapshot
  );
}

function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatus,
    () => "idle" as const,
  );
}

const STATUS_ICONS: Record<SyncStatus, typeof Cloud> = {
  idle: Cloud,
  uploading: Loader2,
  downloading: Loader2,
  error: CloudOff,
};

export function GoogleAuthButton() {
  const auth = useAuth();
  const syncStatus = useSyncStatus();

  if (!isGoogleAuthConfigured()) return null;

  if (!auth || auth.expired) {
    return (
      <div className="space-y-1">
        {auth?.expired && (
          <p className="px-3 text-[10px] text-destructive">Session expired</p>
        )}
        <button
          type="button"
          onClick={() => loginWithGoogle()}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full"
        >
          <LogIn className="h-4 w-4" />
          {auth?.expired ? "Sign in again" : "Sign in with Google"}
        </button>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[syncStatus];

  return (
    <div className="space-y-1">
      {/* User info */}
      <div className="flex items-center gap-3 rounded-lg px-3 py-2">
        {auth.user.picture ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external Google avatar URL, next/image can't optimize it */
          <img
            src={auth.user.picture}
            alt=""
            className="h-6 w-6 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-6 w-6 rounded-full bg-sidebar-accent" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{auth.user.name}</p>
          <p className="text-[10px] text-sidebar-foreground/50 truncate">{auth.user.email}</p>
        </div>
      </div>

      {/* Sync status */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs",
          syncStatus === "error"
            ? "text-destructive"
            : "text-sidebar-foreground/50",
        )}
      >
        <StatusIcon
          className={cn("h-3.5 w-3.5", (syncStatus === "uploading" || syncStatus === "downloading") && "animate-spin")}
        />
        {syncStatus === "idle" && "Synced"}
        {syncStatus === "uploading" && "Saving..."}
        {syncStatus === "downloading" && "Loading..."}
        {syncStatus === "error" && "Sync failed"}
      </div>

      {/* Sign out */}
      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs transition-colors text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </div>
  );
}
