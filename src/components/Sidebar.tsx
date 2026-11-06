import React from "react";
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
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate, userRole }) => {
  return (
    <div className="w-64 bg-ink text-white h-screen flex flex-col">
      <div className="px-6 py-5">
        <Logo inverted />
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5" aria-label="Main">
        {NAV_ITEMS.filter(item => !item.roles || (userRole && item.roles.includes(userRole as any))).map((item) => {
          const isActive = currentPath === item.path;
          const label = item.path === "/" && userRole === "instructor" ? "Instructor Home" :
                        item.path === "/" && userRole === "admin" ? "Admin Dashboard" : item.label;
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "lp-focus-dark relative w-full flex items-center gap-3 px-4 py-2.5 rounded-[10px] text-[15px] transition-colors duration-150 group",
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
    </div>
  );
};
