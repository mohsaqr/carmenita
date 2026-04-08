import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/AppHeader";
import { StaticApiBootstrap } from "@/components/StaticApiBootstrap";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Carmenita — AI Quiz Generator",
  description: "Generate multiple-choice quizzes from your documents and track your learning over time.",
};

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
        <StaticApiBootstrap />
        <TooltipProvider>
          <div className="flex min-h-screen w-full flex-col">
            <AppHeader />
            <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6">
              {children}
            </main>
          </div>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
