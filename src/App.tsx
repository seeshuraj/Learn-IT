import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { supabase } from "./services/supabaseClient";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { User } from "./types";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import { API_BASE } from "./services/api";

// Every page behind sign-in (and the password pages) loads on first visit, so
// the landing and login pages don't download charts, grading or admin code.
// After a deploy, an open tab may ask for a page file that no longer exists.
// Reload once to pick up the new build instead of showing a blank screen.
function loadPage<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().then(
    m => { try { sessionStorage.removeItem("learnit_chunk_reload"); } catch {} return m; },
    err => {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem("learnit_chunk_reload") === "1"; } catch {}
      if (!reloaded) {
        try { sessionStorage.setItem("learnit_chunk_reload", "1"); } catch {}
        window.location.reload();
        return new Promise<T>(() => {});
      }
      throw err;
    },
  );
}

const lazyPage = (load: () => Promise<{ default: React.ComponentType<any> }>) => React.lazy(loadPage(load));
const named = <T, K extends keyof T>(load: () => Promise<T>, key: K) =>
  React.lazy(loadPage(() => load().then(m => ({ default: m[key] as unknown as React.ComponentType<any> }))));

const DashboardPage         = named(() => import("./pages/DashboardPage"), "DashboardPage");
const CoursesPage           = named(() => import("./pages/CoursesPage"), "CoursesPage");
const CourseDetailPage      = named(() => import("./pages/CourseDetailPage"), "CourseDetailPage");
const InstructorDashboard   = named(() => import("./pages/InstructorDashboard"), "InstructorDashboard");
const AdminDashboard        = named(() => import("./pages/AdminDashboard"), "AdminDashboard");
const AdminUserManagement   = named(() => import("./pages/AdminUserManagement"), "AdminUserManagement");
const AdminSettings         = named(() => import("./pages/AdminSettings"), "AdminSettings");
const AdminDataPage         = named(() => import("./pages/AdminDataPage"), "AdminDataPage");
const AssignmentsPage       = lazyPage(() => import("./pages/AssignmentsPage"));
const AnalyticsPage         = lazyPage(() => import("./pages/AnalyticsPage"));
const NotesPage             = lazyPage(() => import("./pages/NotesPage"));
const AdminCourseManagement = lazyPage(() => import("./pages/AdminCourseManagement"));
const ChangePasswordPage    = lazyPage(() => import("./pages/ChangePasswordPage"));
const ForgotPasswordPage    = lazyPage(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage     = lazyPage(() => import("./pages/ResetPasswordPage"));
const RoadmapPage           = lazyPage(() => import("./pages/RoadmapPage"));
const AssessmentsPage       = lazyPage(() => import("./pages/AssessmentsPage"));

/** Shown while a page's code downloads (usually well under a second). */
const PageLoading: React.FC = () => (
  <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
    <span className="sr-only">Loading…</span>
  </div>
);


const AppContent: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(() => {
    try {
      const saved = sessionStorage.getItem("learnit_user");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [forceChange, setForceChange] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);
  // Navigation drawer on phones/tablets (below the lg breakpoint).
  const [menuOpen, setMenuOpen] = React.useState(false);
  const closeMenu = React.useCallback(() => setMenuOpen(false), []);

  const navigate = useNavigate();
  const location = useLocation();

  const checkForceChange = React.useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setAuthChecked(true); return; }
      const res = await fetch(`${API_BASE}/api/auth/me`, {
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
    supabase.auth.signOut();
    navigate("/landing");
  };

  const handlePasswordChanged = () => {
    setForceChange(false);
    navigate("/", { replace: true });
  };

  if (location.pathname === "/landing") return <LandingPage />;
  if (location.pathname === "/login") return <LoginPage onLogin={handleLogin} />;
  if (location.pathname === "/forgot-password") return <React.Suspense fallback={<PageLoading />}><ForgotPasswordPage /></React.Suspense>;
  if (location.pathname === "/reset-password") return <React.Suspense fallback={<PageLoading />}><ResetPasswordPage /></React.Suspense>;
  if (!user) return <Navigate to="/landing" replace />;
  if (!authChecked) return null;

  if (forceChange) {
    return <React.Suspense fallback={<PageLoading />}><ChangePasswordPage onSuccess={handlePasswordChanged} /></React.Suspense>;
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar
        currentPath={location.pathname}
        onNavigate={(path) => navigate(path)}
        userRole={user?.role}
        open={menuOpen}
        onClose={closeMenu}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header user={user} onLogout={handleLogout} onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main className="app-main flex-1 min-w-0 px-4 py-5 sm:p-6 lg:p-8">
          <React.Suspense fallback={<PageLoading />}>
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
            {user?.role === "instructor" && (
              <Route path="/assessments" element={<AssessmentsPage user={user!} />} />
            )}
            {user?.role === "student" && (
              <Route path="/roadmap" element={<RoadmapPage user={user!} />} />
            )}
            {user?.role === "admin" && (
              <>
                <Route path="/admin/users" element={<AdminUserManagement />} />
                <Route path="/admin/courses" element={<AdminCourseManagement />} />
                <Route path="/admin/settings" element={<AdminSettings />} />
                <Route path="/admin/data" element={<AdminDataPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </React.Suspense>
        </main>
      </div>
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
