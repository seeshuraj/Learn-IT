import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { User } from "../types";
import { LogOut, Menu, Search, X } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
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
  // Phones: the search box doesn't fit in the bar, so a button opens it in a
  // panel under the header. It closes on a result, Escape, ✕ or a page change.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const { pathname, search } = useLocation();
  useEffect(() => { setSearchOpen(false); }, [pathname, search]);
  const closeSearch = () => { setSearchOpen(false); searchButton.current?.focus(); };

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
        <GlobalSearch role={user?.role} />
      </div>

      <div className="flex items-center gap-2 sm:gap-4 ml-auto">
        <button
          ref={searchButton}
          type="button"
          onClick={() => setSearchOpen(o => !o)}
          className="lp-focus md:hidden rounded-[10px] p-2 text-ink hover:bg-ink/5"
          aria-label="Search"
          aria-expanded={searchOpen}
          aria-controls="mobile-search"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
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

      {searchOpen && (
        <div id="mobile-search" className="md:hidden absolute inset-x-0 top-full flex items-center gap-2 border-b border-rule bg-paper px-3 py-2 shadow-sm">
          <GlobalSearch role={user?.role} autoFocus onClose={closeSearch} />
          <button
            type="button"
            onClick={closeSearch}
            className="lp-focus shrink-0 rounded-[10px] p-2 text-ink hover:bg-ink/5"
            aria-label="Close search"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </header>
  );
};
