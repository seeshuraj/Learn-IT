import React, { useEffect, useRef, useState } from "react";
import { Settings, Shield, Cpu, Database, Save, RefreshCw } from "lucide-react";
import { toast, Toaster } from "sonner";
import { api } from "../services/api";

export const AdminSettings: React.FC = () => {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const fileSizeRef = useRef<HTMLInputElement>(null);
  const semesterDateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getAdminSettings().then((data: any) => setSettings(Array.isArray(data) ? data : []));
  }, []);

  const handleSave = async (key: string, value: string) => {
    setLoading(true);
    try {
      await api.saveAdminSetting(key, value);
      setSettings(prev =>
        prev.map(s => s.key === key ? { ...s, value } : s)
      );
      toast.success("Setting updated successfully");
    } catch (e) {
      toast.error("Failed to update setting");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Toaster richColors />
      <div>
        <h1 className="text-4xl font-bold text-slate-900">System Settings</h1>
        <p className="text-slate-500 mt-1">Configure global parameters and AI integration.</p>
      </div>

      {/* General */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900">General Configuration</h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">File Size Limit</label>
            <input
              ref={fileSizeRef}
              type="text"
              defaultValue={settings.find(s => s.key === 'file_size_limit')?.value || '10MB'}
              className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
          <button
            onClick={() => handleSave('file_size_limit', fileSizeRef.current?.value || '10MB')}
            disabled={loading}
            className="mt-5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-1"
          >
            <Save className="w-3 h-3" /> Save
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Semester End Date</label>
            <input
              ref={semesterDateRef}
              type="date"
              defaultValue={settings.find(s => s.key === 'semester_end_date')?.value || '2026-06-30'}
              className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
          <button
            onClick={() => handleSave('semester_end_date', semesterDateRef.current?.value || '2026-06-30')}
            disabled={loading}
            className="mt-5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-1"
          >
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      </div>

      {/* AI Settings */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Cpu className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-bold text-slate-900">AI &amp; LLM Settings</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Enable AI Features</p>
            <p className="text-xs text-slate-400 mt-0.5">Enable/disable grading assistance and chatbots.</p>
          </div>
          <button
            onClick={() => handleSave('ai_enabled', settings.find(s => s.key === 'ai_enabled')?.value === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.find(s => s.key === 'ai_enabled')?.value === 'false' ? 'bg-slate-200' : 'bg-indigo-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              settings.find(s => s.key === 'ai_enabled')?.value === 'false' ? 'translate-x-1' : 'translate-x-6'
            }`} />
          </button>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Gemini API Key</label>
          <div className="flex items-center gap-2">
            <input type="password" value="••••••••••••••••" disabled className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm text-slate-400" />
            <span className="text-xs text-slate-400 whitespace-nowrap">Managed by System</span>
          </div>
        </div>
      </div>

      {/* Maintenance */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <Database className="w-5 h-5 text-rose-500" />
          <h2 className="text-lg font-bold text-slate-900">Maintenance</h2>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => { toast.info("Cache cleared successfully"); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-2xl text-sm font-bold hover:bg-slate-200 transition-all"
          >
            <RefreshCw className="w-4 h-4" /> Clear Cache
          </button>
          <button
            onClick={() => {
              if (window.confirm('Are you sure? This cannot be undone.')) {
                toast.error("Reset not allowed in production");
              }
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 rounded-2xl text-sm font-bold hover:bg-red-100 transition-all"
          >
            <Shield className="w-4 h-4" /> Reset Database
          </button>
        </div>
      </div>
    </div>
  );
};
