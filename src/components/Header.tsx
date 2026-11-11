import React from "react";
import { User } from "../types";
import { LogOut, Menu, Search } from "lucide-react";
import NotificationBell from "./NotificationBell";
import { Logo } from "./brand/Logo";

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  /** Opens the navigation drawer below the lg breakpoint. */
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ user, onLogout, onOpenMenu, menuOpen = false }) => {
  return (
    <header className="h-16 bg-paper/90 backdrop-blur border-b border-rule px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 sticky top-0 z-30">
      <div className="flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={onOpenMenu}
          className="lp-focus rounded-[10px] p-2 text-ink hover:bg-ink/5"
          aria-label="Open menu"
          aria-controls="app-sidebar"
          aria-expanded={menuOpen}
        >
          <Menu className="h-6 w-6" />
        </button>
        <Logo className="sm:hidden [&>span:last-child]:hidden min-[380px]:[&>span:last-child]:inline" />
      </div>

      <div className="hidden md:flex items-center gap-4 flex-1 max-w-xl">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search"
            placeholder="Search courses, assignments, or notes..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-rule rounded-[10px] text-sm text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 ml-auto">
        <NotificationBell />

        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-rule">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-ink">{user?.name}</p>
            <p className="text-xs text-muted capitalize">{user?.role}</p>
          </div>
          <button
            onClick={onLogout}
            className="lp-focus inline-flex items-center gap-1.5 rounded-[10px] border border-rule bg-white px-2.5 sm:px-3 py-2 text-sm font-medium text-ink hover:border-ink/30 transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
