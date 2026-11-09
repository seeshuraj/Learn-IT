import React, { useEffect, useState } from "react";
import { Users, BookOpen, TrendingUp, Activity, Sparkles } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie
} from "recharts";
import { api } from "../services/api";

interface AdminStats {
  activeUsers: number;
  totalCourses: number;
  averageGrade: number;
}

interface AiUsage {
  month: { used: number; budget: number | null; remaining: number | null };
  days: number;
  activeUsers: number;
  byFeature: Array<{ feature: string; calls: number; tokens: number; errors: number; avgLatencyMs: number }>;
  byCourse: Array<{ id: number; name: string; calls: number; tokens: number }>;
}

const FEATURE_LABELS: Record<string, string> = {
  tutor_chat: "Notes tutor",
  grading: "AI grading",
  roadmap: "Study roadmaps",
  exam_analysis: "Exam analysis",
  analytics_summary: "Analytics summaries",
  notes: "Notes",
  ai_other: "Other AI",
  other: "Other",
};

const ROLE_LABELS: Record<string, string> = { student: "Students", instructor: "Instructors", admin: "Admins" };

const compact = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [usageError, setUsageError] = useState(false);
  const [roles, setRoles] = useState<Array<{ name: string; value: number }>>([]);

  useEffect(() => {
    api.getAdminStats()
      .then((data: any) => setStats(data))
      .catch((e: any) => setError(e.message));
    api.getAiUsage(30)
      .then((data: any) => setUsage(data))
      .catch(() => setUsageError(true));
    api.getAdminUsers()
      .then((list: any) => {
        const counts: Record<string, number> = {};
        for (const u of Array.isArray(list) ? list : []) counts[u.role] = (counts[u.role] ?? 0) + 1;
        setRoles(Object.entries(counts).map(([role, value]) => ({ name: ROLE_LABELS[role] ?? role, value })));
      })
      .catch(() => setRoles([]));
  }, []);

  if (error) return (
    <div className="p-8 text-red-500">Failed to load stats: {error}</div>
  );
  if (!stats) return null;

  const PIE_DATA = roles;
  const featureData = (usage?.byFeature ?? []).map(f => ({ name: FEATURE_LABELS[f.feature] ?? f.feature, tokens: f.tokens, calls: f.calls }));
  const pctUsed = usage?.month.budget ? Math.min(100, Math.round((usage.month.used / usage.month.budget) * 100)) : null;
  const COLORS = ["#2448B8", "#8FA6E6", "#13203B"];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Admin Command Center</h1>
          <p className="text-slate-500 mt-1">Global system overview and analytics.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-indigo-100 p-3 rounded-2xl text-indigo-600">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Active Users</p>
              <h3 className="text-2xl font-bold text-slate-900">{stats.activeUsers}</h3>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium">Across all roles</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-purple-100 p-3 rounded-2xl text-purple-600">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Total Courses</p>
              <h3 className="text-2xl font-bold text-slate-900">{stats.totalCourses}</h3>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium">Active semesters</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-600">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Avg Pass Rate</p>
              <h3 className="text-2xl font-bold text-slate-900">{stats.averageGrade}%</h3>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium">Global average</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            User Distribution
          </h3>
          {PIE_DATA.length === 0 ? (
            <p className="text-sm text-slate-500">No users yet. Add them under User Management.</p>
          ) : (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={PIE_DATA} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                  {PIE_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          )}
          <div className="flex justify-center gap-6 mt-4">
            {PIE_DATA.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{entry.name} · {entry.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            AI usage
          </h3>
          <p className="text-xs text-slate-500 mb-5">Tokens used by your college, last {usage?.days ?? 30} days</p>

          {usageError && <p className="text-sm text-slate-500">AI usage couldn't be loaded. Try again later.</p>}
          {usage && (
            <>
              <div className="mb-6">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-slate-900">This month: {compact(usage.month.used)} tokens</span>
                  <span className="text-slate-500">
                    {usage.month.budget ? `of ${compact(usage.month.budget)} allowance` : "No monthly limit"}
                  </span>
                </div>
                {pctUsed !== null && (
                  <div className="mt-2 h-2.5 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${pctUsed}% of this month's AI allowance used`}>
                    <div
                      className={`h-full rounded-full ${pctUsed >= 90 ? "bg-red-600" : pctUsed >= 70 ? "bg-amber-500" : "bg-indigo-600"}`}
                      style={{ width: `${pctUsed}%` }}
                    />
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">{usage.activeUsers} people used AI features in this period.</p>
              </div>

              {featureData.length === 0 ? (
                <p className="text-sm text-slate-500">No AI usage yet in this period.</p>
              ) : (
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={featureData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={compact} />
                      <YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#334155' }} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v: any, k: any) => [compact(Number(v)), k === "tokens" ? "Tokens" : k]} />
                      <Bar dataKey="tokens" fill="#2448B8" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {usage.byCourse.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Top courses</p>
                  <ul className="space-y-1 text-sm">
                    {usage.byCourse.slice(0, 5).map(c => (
                      <li key={c.id} className="flex justify-between gap-4">
                        <span className="truncate text-slate-700">{c.name}</span>
                        <span className="tabular-nums text-slate-500">{compact(c.tokens)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
