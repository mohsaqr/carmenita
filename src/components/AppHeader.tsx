import Link from "next/link";
import { GraduationCap, Menu } from "lucide-react";

interface AppHeaderProps {
  onMenuClick: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
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
      {/* Desktop: empty bar provides top edge */}
    </header>
  );
}
