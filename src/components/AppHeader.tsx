import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { HeaderNav } from "@/components/HeaderNav";

export function AppHeader() {
  return (
    <header className="flex h-14 items-center gap-4 border-b px-4 sm:px-6 lg:px-8">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <GraduationCap className="h-5 w-5" />
        <span>Carmenita</span>
      </Link>
      <HeaderNav />
    </header>
  );
}
