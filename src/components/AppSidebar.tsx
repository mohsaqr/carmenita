"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  Sparkles,
  Library,
  BarChart3,
  Trash2,
  Settings,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/take", label: "Take quiz", icon: BookOpen },
  { href: "/attempts", label: "Attempts", icon: ClipboardList },
  { href: "/create", label: "Create", icon: Sparkles },
  { href: "/bank", label: "Bank", icon: Library },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
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

  const sidebarContent = (
    <>
      {/* Logo header */}
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <GraduationCap className="h-5 w-5" />
        <span>Carmenita</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV_LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(link.href);
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
