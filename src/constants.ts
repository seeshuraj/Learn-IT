import { LucideIcon, LayoutDashboard, BookOpen, FileText, BarChart3, LogOut, MessageSquare } from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/" },
  { label: "Courses", icon: BookOpen, path: "/courses" },
  { label: "Assignments", icon: FileText, path: "/assignments" },
  { label: "Analytics", icon: BarChart3, path: "/analytics" },
];
