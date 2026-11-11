import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { NAV_ITEMS } from "../constants";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Logo } from "./brand/Logo";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  userRole?: string;
  /** Phones and tablets: whether the slide-out menu is open. Ignored on desktop. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * Desktop (lg+): fixed column beside the content.
 * Below lg: off-canvas drawer opened from the header's menu button, with a
 * backdrop; closes on navigation, backdrop tap or Escape.
 */
export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate, userRole, open = false, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    // Keep the page behind the drawer from scrolling.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const items = NAV_ITEMS.filter(item => !item.roles || (userRole && item.roles.includes(userRole as any)));

  return (
    <>
      {/* Backdrop (mobile only) */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-ink/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="app-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-ink text-white flex flex-col transition-transform duration-200 ease-out",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:max-w-none lg:translate-x-0 lg:shrink-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between px-6 py-5">
          <Logo inverted />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="lp-focus-dark -mr-2 rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5" aria-label="Main">
          {items.map((item) => {
            const isActive = currentPath === item.path;
            const label = item.path === "/" && userRole === "instructor" ? "Instructor Home" :
                          item.path === "/" && userRole === "admin" ? "Admin Dashboard" : item.label;
            return (
              <button
                key={item.path}
                onClick={() => { onNavigate(item.path); onClose?.(); }}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "lp-focus-dark relative w-full flex items-center gap-3 px-4 py-3 lg:py-2.5 rounded-[10px] text-[15px] transition-colors duration-150 group",
                  isActive
                    ? "bg-white/10 text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-pen"
                    : "text-white/65 hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className={cn("w-[18px] h-[18px]", isActive ? "text-white" : "text-white/55 group-hover:text-white")} />
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
};
