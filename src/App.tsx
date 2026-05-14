import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { ChatBot } from "./components/ChatBot";
import { User } from "./types";
import { DashboardPage } from "./pages/DashboardPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import AssignmentsPage from "./pages/AssignmentsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import NotesPage from "./pages/NotesPage";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import { InstructorDashboard } from "./pages/InstructorDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminUserManagement } from "./pages/AdminUserManagement";
import AdminCourseManagement from "./pages/AdminCourseManagement";
import { AdminSettings } from "./pages/AdminSettings";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import RoadmapPage from "./pages/RoadmapPage";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const AppContent: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(() => {
    try {
      const saved = sessionStorage.getItem("learnit_user");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [forceChange, setForceChange] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const checkForceChange = React.useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setAuthChecked(true); return; }
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setForceChange(!!data.force_password_change);
      }
    } catch {}
    setAuthChecked(true);
  }, []);

  React.useEffect(() => {
    if (user) { checkForceChange(); }
    else { setAuthChecked(true); }
  }, [user, checkForceChange]);

  const handleLogin = (userData: User) => {
    setUser(userData);
    try { sessionStorage.setItem("learnit_user", JSON.stringify(userData)); } catch {}
  };

  React.useEffect(() => {
    if (!authChecked || !user) return;
    if (forceChange && location.pathname !== "/change-password") {
      navigate("/change-password", { replace: true });
    } else if (!forceChange && location.pathname === "/change-password") {
      navigate("/", { replace: true });
    } else if (location.pathname === "/login" || location.pathname === "/landing") {
      navigate("/", { replace: true });
    }
  }, [authChecked, user, forceChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = () => {
    setUser(null);
    setForceChange(false);
    setAuthChecked(false);
    try { sessionStorage.removeItem("learnit_user"); } catch {}
    navigate("/landing");
  };

  const handlePasswordChanged = () => {
    setForceChange(false);
    navigate("/", { replace: true });
  };

  if (location.pathname === "/landing") return <LandingPage />;
  if (location.pathname === "/login") return <LoginPage onLogin={handleLogin} />;
  if (!user) return <Navigate to="/landing" replace />;
  if (!authChecked) return null;

  if (forceChange) {
    return <ChangePasswordPage onSuccess={handlePasswordChanged} />;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        currentPath={location.pathname}
        onNavigate={(path) => navigate(path)}
        userRole={user?.role}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header user={user} onLogout={handleLogout} />
        <main className="flex-1 overflow-y-auto p-8">
          <Routes>
            <Route path="/" element={
              user?.role === "instructor" ? <InstructorDashboard user={user} /> :
              user?.role === "admin" ? <AdminDashboard /> :
              <DashboardPage user={user!} />
            } />
            <Route path="/courses" element={<CoursesPage user={user!} />} />
            <Route path="/courses/:id" element={<CourseDetailPage user={user!} />} />
            <Route path="/assignments" element={<AssignmentsPage user={user!} />} />
            <Route path="/notes" element={<NotesPage user={user!} />} />
            <Route path="/analytics" element={<AnalyticsPage user={user!} />} />
            {user?.role === "student" && (
              <Route path="/roadmap" element={<RoadmapPage user={user!} />} />
            )}
            {user?.role === "admin" && (
              <>
                <Route path="/admin/users" element={<AdminUserManagement />} />
                <Route path="/admin/courses" element={<AdminCourseManagement />} />
                <Route path="/admin/settings" element={<AdminSettings />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {user?.role !== "admin" && <ChatBot moduleTitle="General Course Assistant" />}
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
