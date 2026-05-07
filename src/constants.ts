import { 
  LucideIcon, LayoutDashboard, BookOpen, FileText, 
  BarChart3, Users, Settings, StickyNote
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  roles?: ('student' | 'instructor' | 'admin')[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/" },
  { label: "Courses", icon: BookOpen, path: "/courses", roles: ['student', 'instructor'] },
  { label: "Assignments", icon: FileText, path: "/assignments", roles: ['student', 'instructor'] },
  { label: "Notes & AI Chat", icon: StickyNote, path: "/notes", roles: ['student', 'instructor'] },
  { label: "Analytics", icon: BarChart3, path: "/analytics", roles: ['student', 'instructor'] },
  { label: "User Management", icon: Users, path: "/admin/users", roles: ['admin'] },
  { label: "Course Management", icon: BookOpen, path: "/admin/courses", roles: ['admin'] },
  { label: "System Settings", icon: Settings, path: "/admin/settings", roles: ['admin'] },
];
