import React from "react";
import { User } from "../types";
import { Search, User as UserIcon } from "lucide-react";
import NotificationBell from "./NotificationBell";

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, onLogout }) => {
  return (
    <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-4 flex-1 max-w-xl">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search courses, assignments, or notes..."
            className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* P3-4: live notification bell */}
        <NotificationBell />

        <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
            <p className="text-xs text-slate-500 capitalize">{user?.role}</p>
          </div>
          <button
            onClick={onLogout}
            className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-200 transition-colors"
            title="Logout"
          >
            <UserIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};
