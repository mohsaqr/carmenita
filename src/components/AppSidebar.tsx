"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  RotateCcw,
  BarChart3,
  Sparkles,
  Inbox,
  Library,
  Trash2,
  Settings,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";

const PRIMARY_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/take", label: "Take quiz", icon: BookOpen },
  { href: "/attempts", label: "Repeat", icon: RotateCcw },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

const SECONDARY_LINKS = [
  { href: "/create", label: "Create", icon: Sparkles },
  { href: "/import", label: "Import", icon: Inbox },
  { href: "/bank", label: "Bank", icon: Library },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function AppSidebar({ open, onClose }: AppSidebarProps) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLElement>(null);

  // Mobile overlay: Escape key dismiss + body scroll lock + focus on open
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handler);
    };
  }, [open, onClose]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href);
  }

  const sidebarContent = (
    <>
      {/* Logo header */}
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <GraduationCap className="h-5 w-5" />
        <span>Carmenita</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col p-3">
        <div className="flex flex-col gap-1">
          {PRIMARY_LINKS.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="my-3 h-px bg-sidebar-foreground/10" />

        <div className="flex flex-col gap-1">
          <span className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            Manage
          </span>
          {SECONDARY_LINKS.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Google account — pinned to bottom */}
      <div className="border-t p-3">
        <GoogleAuthButton />
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar -- always visible at md+ */}
      <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile overlay sidebar */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Slide-in panel */}
          <aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Navigation"
            className="relative flex w-60 h-full flex-col bg-sidebar text-sidebar-foreground shadow-lg outline-none"
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
