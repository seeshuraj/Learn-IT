import React from "react";
import { NAV_ITEMS } from "../constants";
import { GraduationCap } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
    <div className="w-64 bg-slate-900 text-white h-screen flex flex-col border-r border-white/10">
      <div className="p-6 flex items-center gap-3">
        <div className="bg-indigo-600 p-2 rounded-lg">
          <GraduationCap className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">LearnIT</h1>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = currentPath === item.path;
          const label = item.path === "/" && userRole === "instructor" ? "Instructor Home" : item.label;
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                isActive 
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "text-slate-400 group-hover:text-white")} />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10">
        <div className="bg-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-2">Pro Tip</p>
          <p className="text-sm text-slate-300">Use the AI Chatbot in your course modules for instant help.</p>
        </div>
      </div>
    </div>
  );
};
