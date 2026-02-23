import React from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { User, Submission } from "../types";
import { Brain, TrendingUp, Target, Award } from "lucide-react";

interface AnalyticsDashboardProps {
  user: User;
  submissions: Submission[];
}

const GPA_DATA = [
  { name: "Year 1 Sem 1", gpa: 3.2 },
  { name: "Year 1 Sem 2", gpa: 3.4 },
  { name: "Year 2 Sem 1", gpa: 3.5 },
  { name: "Year 2 Sem 2", gpa: 3.6 },
  { name: "Year 3 Sem 1", gpa: 3.7 },
];

const SKILL_DATA = [
  { subject: "Theory", A: 85, fullMark: 100 },
  { subject: "Coding", A: 62, fullMark: 100 },
  { subject: "Design", A: 78, fullMark: 100 },
  { subject: "Analysis", A: 90, fullMark: 100 },
  { subject: "Math", A: 82, fullMark: 100 },
];

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ user, submissions }) => {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-indigo-100 p-3 rounded-xl text-indigo-600">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Current GPA</p>
              <h3 className="text-2xl font-bold text-slate-900">{user.gpa}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
            <span>+0.1 from last semester</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-amber-100 p-3 rounded-xl text-amber-600">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Rank</p>
              <h3 className="text-2xl font-bold text-slate-900">Top 10%</h3>
            </div>
          </div>
          <p className="text-xs text-slate-500">In {user.major}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-emerald-100 p-3 rounded-xl text-emerald-600">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Credits</p>
              <h3 className="text-2xl font-bold text-slate-900">84 / 120</h3>
            </div>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full w-[70%]"></div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-purple-100 p-3 rounded-xl text-purple-600">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">AI Insight</p>
              <h3 className="text-sm font-bold text-slate-900">Focus on Implementation</h3>
            </div>
          </div>
          <p className="text-xs text-slate-500">Based on recent submissions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">GPA Longitudinal Trend</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={GPA_DATA}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                <YAxis domain={[3.0, 4.0]} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="gpa" stroke="#4f46e5" strokeWidth={3} dot={{ r: 6, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Skill Gap Analysis</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={SKILL_DATA}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#64748b' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Skills" dataKey="A" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.4} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-indigo-900 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center gap-8">
        <div className="flex-1">
          <h3 className="text-2xl font-bold mb-2">Career Recommendation</h3>
          <p className="text-indigo-200 mb-6">Based on your high performance in Theory and Analysis, we recommend exploring <strong>Machine Learning Research</strong> or <strong>Data Architecture</strong> roles.</p>
          <div className="flex gap-4">
            <button className="bg-white text-indigo-900 px-6 py-2 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors">View Career Path</button>
            <button className="bg-indigo-800 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors">Find Mentors</button>
          </div>
        </div>
        <div className="w-32 h-32 bg-indigo-800/50 rounded-full flex items-center justify-center border border-indigo-700">
          <Brain className="w-16 h-16 text-indigo-300" />
        </div>
      </div>
    </div>
  );
};
