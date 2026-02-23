import React, { useState } from "react";
import { User } from "../types";
import { GraduationCap, ArrowRight, Mail, Lock, Loader2 } from "lucide-react";

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [email, setEmail] = useState("sarah@learnit.edu");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      
      if (response.ok) {
        const user = await response.json();
        onLogin(user);
      } else {
        setError("Invalid email. Try sarah@learnit.edu, instructor@learnit.edu, or admin@learnit.edu");
      }
    } catch (err) {
      setError("Connection failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full"></div>
      </div>

      <div className="w-full max-w-md relative">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="p-8 bg-indigo-600 text-white text-center">
            <div className="inline-flex bg-white/20 p-3 rounded-2xl mb-4">
              <GraduationCap className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Welcome to LearnIT</h1>
            <p className="text-indigo-100 text-sm">The AI-Powered Learning Experience</p>
          </div>

          <div className="p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ml-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@university.edu"
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ml-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input 
                    type="password" 
                    defaultValue="password"
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
              </div>

              {error && <p className="text-red-500 text-xs font-medium text-center">{error}</p>}

              <button 
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <>
                    Sign In <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 pt-8 border-t border-slate-100 text-center">
              <p className="text-slate-500 text-sm mb-4">Demo Accounts:</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button onClick={() => setEmail("sarah@learnit.edu")} className="px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors">Sarah (Student)</button>
                <button onClick={() => setEmail("michael@learnit.edu")} className="px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors">Michael (Student)</button>
                <button onClick={() => setEmail("instructor@learnit.edu")} className="px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors">Dr. Aris (Instructor)</button>
                <button onClick={() => setEmail("admin@learnit.edu")} className="px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors">Admin</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
