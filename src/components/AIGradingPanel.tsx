import React, { useState } from "react";
import { Sparkles, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp, TrendingUp, AlertCircle } from "lucide-react";
import { getGradingSuggestion, GradingSuggestion } from "../services/aiService";
import { Submission } from "../types";

interface Props {
  submission: Submission;
  rubric?: string;
  assignmentTitle?: string;
  onAccept: (score: number, feedback: string) => void;
}

export const AIGradingPanel: React.FC<Props> = ({
  submission,
  rubric = "Assess clarity of argument (30%), technical accuracy (40%), and presentation (30%).",
  assignmentTitle = "Assignment",
  onAccept,
}) => {
  const [suggestion, setSuggestion] = useState<GradingSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [overrideScore, setOverrideScore] = useState<number | null>(null);

  const runGrading = async () => {
    setLoading(true);
    setError("");
    setAccepted(false);
    try {
      const result = await getGradingSuggestion(
        submission.content,
        rubric,
        assignmentTitle
      );
      setSuggestion(result);
      setOverrideScore(result.score);
    } catch (e: any) {
      setError(e.message ?? "AI grading failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    if (!suggestion) return;
    const finalScore = overrideScore ?? suggestion.score;
    onAccept(finalScore, suggestion.feedback);
    setAccepted(true);
  };

  const scoreColor = (s: number) =>
    s >= 80 ? "text-emerald-600" : s >= 60 ? "text-amber-600" : "text-red-600";
  const scoreBg = (s: number) =>
    s >= 80 ? "bg-emerald-50 border-emerald-200" : s >= 60 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  return (
    <div className="border border-violet-200 rounded-xl bg-gradient-to-br from-violet-50 to-white overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-800">AI Grading Assistant</span>
          {accepted && (
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
              Grade accepted
            </span>
          )}
          {!suggestion && !loading && (
            <span className="text-xs text-violet-500">— powered by NVIDIA NIM</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!suggestion && !loading && (
            <button
              onClick={(e) => { e.stopPropagation(); runGrading(); }}
              className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3" />
              Suggest Grade
            </button>
          )}
          {loading && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-violet-100">
          {loading && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
              <p className="text-sm text-slate-500">Analysing submission with NVIDIA NIM…</p>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {suggestion && !loading && (
            <div className="mt-3 space-y-3">
              {/* Score */}
              <div className={`flex items-center justify-between p-3 rounded-lg border ${scoreBg(overrideScore ?? suggestion.score)}`}>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">AI Suggested Score</p>
                  <p className={`text-2xl font-bold ${scoreColor(overrideScore ?? suggestion.score)}`}>
                    {overrideScore ?? suggestion.score}<span className="text-sm font-normal text-slate-400">/100</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Override:</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={overrideScore ?? suggestion.score}
                    onChange={(e) => setOverrideScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                    className="w-16 text-center border border-slate-300 rounded-lg px-2 py-1 text-sm font-semibold"
                  />
                </div>
              </div>

              {/* Feedback */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Feedback</p>
                <p className="text-sm text-slate-700 leading-relaxed">{suggestion.feedback}</p>
              </div>

              {/* Strengths + Improvements */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Strengths
                  </p>
                  <ul className="space-y-1">
                    {suggestion.strengths.map((s, i) => (
                      <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> To Improve
                  </p>
                  <ul className="space-y-1">
                    {suggestion.improvements.map((s, i) => (
                      <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Actions */}
              {!accepted ? (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleAccept}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Accept & Apply Grade
                  </button>
                  <button
                    onClick={runGrading}
                    className="px-3 py-2 border border-slate-300 hover:border-slate-400 rounded-lg text-sm text-slate-600 transition-colors"
                    title="Re-run AI grading"
                  >
                    <Loader2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm text-emerald-700 font-medium">
                    Grade {overrideScore ?? suggestion.score}/100 applied
                  </span>
                </div>
              )}
            </div>
          )}

          {!suggestion && !loading && !error && (
            <p className="text-xs text-slate-400 mt-3 text-center">
              Click "Suggest Grade" to analyse this submission with AI
            </p>
          )}
        </div>
      )}
    </div>
  );
};
