import React, { useEffect, useState } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { getAnalyticsSummary, StudentAnalyticsData } from "../services/aiService";

interface Props {
  data: StudentAnalyticsData;
  autoLoad?: boolean;
}

export const AIAnalyticsSummary: React.FC<Props> = ({ data, autoLoad = true }) => {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [displayed, setDisplayed] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    setSummary("");
    setDisplayed("");
    try {
      const text = await getAnalyticsSummary(data);
      setSummary(text);
    } catch (e: any) {
      setError(e.message ?? "Failed to load AI summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoLoad) load();
  }, [data.studentName]);

  // Typewriter reveal effect
  useEffect(() => {
    if (!summary) return;
    let i = 0;
    setDisplayed("");
    const interval = setInterval(() => {
      i++;
      setDisplayed(summary.slice(0, i));
      if (i >= summary.length) clearInterval(interval);
    }, 12);
    return () => clearInterval(interval);
  }, [summary]);

  const renderMarkdown = (text: string) =>
    text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-800">$1</strong>')
      .replace(/\n/g, "<br/>");

  return (
    <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-800">AI Performance Summary</span>
          <span className="text-xs text-violet-400">— NVIDIA NIM</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 hover:bg-violet-100 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh summary"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-violet-500 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4">
          <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
          <span className="text-sm text-slate-500">Generating AI summary…</span>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {displayed && !loading && (
        <p
          className="text-sm text-slate-700 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(displayed) }}
        />
      )}

      {!loading && !summary && !error && (
        <button
          onClick={load}
          className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1.5 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Generate AI summary
        </button>
      )}
    </div>
  );
};
