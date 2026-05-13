import { useState } from 'react';
import { User } from '../types';
import { api, supabaseSignIn } from '../services/api';

const DEMO_ACCOUNTS = [
  { role: 'Admin',      email: 'admin@learnit.edu',      label: 'Admin' },
  { role: 'Instructor', email: 'instructor@learnit.edu', label: 'Instructor' },
  { role: 'Student',    email: 'sarah@learnit.edu',      label: 'Student' },
];

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();

      // 1. Authenticate with Supabase Auth → stores access token in sessionStorage.
      const { session } = await supabaseSignIn(normalizedEmail, password);
      console.log('SUPABASE_SESSION', session?.access_token?.slice(0, 20), !!session);

      if (!session?.access_token) {
        throw new Error('Supabase session was not established. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars.');
      }

      // 2. Fetch the legacy user record from our Express API.
      //    requireAuth on protected routes will validate the Supabase token we just got.
      const user = await api.login(normalizedEmail);
      onLogin(user);
    } catch (err: any) {
      setError(err.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="40" height="40" rx="10" fill="#01696f"/>
              <text x="7" y="29" fontFamily="Georgia,serif" fontSize="26" fontWeight="bold" fill="white">L</text>
              <circle cx="29" cy="12" r="5" fill="#4f98a3" opacity="0.9"/>
            </svg>
            <span className="text-2xl font-bold text-slate-800 tracking-tight">LearnIT</span>
          </div>
          <p className="text-slate-500 text-sm">AI-Powered Learning Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          <h1 className="text-xl font-semibold text-slate-800 mb-1">Sign in</h1>
          <p className="text-slate-500 text-sm mb-6">Enter your university email and password to continue</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm transition"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition"
            >
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>

          {/* Demo accounts */}
          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 mb-3 uppercase tracking-wide font-medium">Demo accounts</p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map(a => (
                <button
                  key={a.role}
                  type="button"
                  onClick={() => setEmail(a.email)}
                  className="text-xs bg-slate-50 hover:bg-teal-50 hover:text-teal-700 border border-slate-200 hover:border-teal-300 text-slate-600 rounded-lg py-2 px-2 font-medium transition"
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">Click a role to pre-fill the email, then enter your password and Sign in</p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          LearnIT · Built with NVIDIA AI · TCD HPC
        </p>
      </div>
    </div>
  );
}
