import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutShell } from "@/components/LayoutShell";
import { PasswordGate } from "@/components/PasswordGate";
import { StaticApiBootstrap } from "@/components/StaticApiBootstrap";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Carmenita — AI Quiz Generator",
  description: "Generate multiple-choice quizzes from your documents and track your learning over time.",
};

/*
 * The inline fetch-interceptor shim is NOT rendered from this file.
 * Instead, `scripts/inject-shim.mjs` runs after `next build` and
 * hoists the shim <script> tag to be the first child of <head> in
 * every exported HTML file. See that script for the rationale and
 * the full shim body.
 *
 * Why the post-build hoist: rendering the <script> here caused Next
 * App Router to serialize it into `self.__next_s.push(...)` — that
 * re-inserts the same script AFTER hydration, overwriting the real
 * sql.js interceptor back to the queueing shim and stranding every
 * subsequent /api call. Removing it from the React tree prevents
 * the double-injection; the post-build step is the only source.
 */

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        suppressHydrationWarning on <html> covers dark-mode extensions
        (which inject `style` on <html>). For form-heavy pages that trip
        password-manager extensions (Proton Pass, 1Password, Dashlane)
        the flag is applied on the page's root wrapper instead — the
        flag is element-scoped, not cascading, so layout-level coverage
        doesn't reach the BankPage / CreatePage / SettingsPage wrappers
        where those extensions actually inject attributes.
      */}
      <body className={inter.className}>
        <PasswordGate>
          <StaticApiBootstrap />
          <TooltipProvider>
            <LayoutShell>
              {children}
            </LayoutShell>
            <Toaster />
          </TooltipProvider>
        </PasswordGate>
      </body>
    </html>
  );
}
