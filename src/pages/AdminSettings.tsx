import React, { useEffect, useState } from "react";
import { Settings, Shield, Cpu, Database, Save, RefreshCw } from "lucide-react";
import { toast, Toaster } from "sonner";

export const AdminSettings: React.FC = () => {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings").then(res => res.json()).then(setSettings);
  }, []);

  const handleSave = async (key: string, value: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (response.ok) {
        toast.success("Setting updated successfully");
      }
    } catch (e) {
      toast.error("Failed to update setting");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Toaster position="top-right" />
      <div>
        <h1 className="text-4xl font-bold text-slate-900">System Settings</h1>
        <p className="text-slate-500 mt-1">Configure global parameters and AI integration.</p>
      </div>

      <div className="space-y-6">
        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-bold text-slate-900">General Configuration</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">File Size Limit</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  defaultValue={settings.find(s => s.key === 'file_size_limit')?.value || '10MB'}
                  className="flex-1 px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
                />
                <button 
                  onClick={() => handleSave('file_size_limit', '10MB')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all"
                >
                  Save
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Semester End Date</label>
              <input 
                type="date" 
                defaultValue="2026-06-30"
                className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <Cpu className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-bold text-slate-900">AI & LLM Settings</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
              <div>
                <p className="text-sm font-bold text-slate-900">Enable AI Features</p>
                <p className="text-xs text-slate-500">Enable/disable grading assistance and chatbots.</p>
              </div>
              <div className="w-12 h-6 bg-indigo-600 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Gemini API Key</label>
              <div className="relative">
                <input 
                  type="password" 
                  value="••••••••••••••••"
                  disabled
                  className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm text-slate-400"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Managed by System</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <Database className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900">Maintenance</h3>
          </div>
          <div className="flex gap-4">
            <button className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-all">
              <RefreshCw className="w-4 h-4" /> Clear Cache
            </button>
            <button className="flex-1 px-4 py-3 bg-red-50 text-red-600 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-all">
              <RefreshCw className="w-4 h-4" /> Reset Database
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
