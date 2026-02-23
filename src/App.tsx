import React from "react";
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate,
  useNavigate,
  useLocation
} from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { User } from "./types";
import { DashboardPage } from "./pages/DashboardPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { LoginPage } from "./pages/LoginPage";
import { InstructorDashboard } from "./pages/InstructorDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminUserManagement } from "./pages/AdminUserManagement";
import { AdminCourseManagement } from "./pages/AdminCourseManagement";
import { AdminSettings } from "./pages/AdminSettings";

const AppContent: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(() => {
    const saved = localStorage.getItem("learnit_user");
    return saved ? JSON.parse(saved) : null;
  });
  
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogin = (userData: User) => {
    setUser(userData);
    localStorage.setItem("learnit_user", JSON.stringify(userData));
    navigate("/");
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("learnit_user");
    navigate("/login");
  };

  if (!user && location.pathname !== "/login") {
    return <Navigate to="/login" replace />;
  }

  if (location.pathname === "/login") {
    return <LoginPage onLogin={handleLogin} />;
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
            <Route path="/analytics" element={<AnalyticsPage user={user!} />} />
            
            {/* Admin Routes */}
            {user?.role === 'admin' && (
              <>
                <Route path="/admin/users" element={<AdminUserManagement />} />
                <Route path="/admin/courses" element={<AdminCourseManagement />} />
                <Route path="/admin/settings" element={<AdminSettings />} />
              </>
            )}
          </Routes>
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
