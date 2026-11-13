import React, { useCallback, useEffect, useState } from "react";
import { Download, ShieldCheck, Users, BookOpen, GraduationCap, ClipboardList } from "lucide-react";
import { toast, Toaster } from "sonner";
import { api, downloadExport } from "../services/api";

type Dataset = "users" | "enrollments" | "grades" | "exam-results";

const EXPORTS: { id: Dataset; title: string; detail: string; icon: React.ElementType }[] = [
  { id: "users",        title: "Users",        detail: "Every account: name, email, role, status, year, major.", icon: Users },
  { id: "enrollments",  title: "Enrolments",   detail: "Which student is in which course, and since when.",    icon: BookOpen },
  { id: "grades",       title: "Grades",       detail: "Every submission with its grade, percentage and feedback.", icon: GraduationCap },
  { id: "exam-results", title: "Exam results", detail: "Unit exam marks, percentage and performance band.",    icon: ClipboardList },
];

/** Audit actions an admin is likely to filter by (prefix match on the server). */
const ACTIONS: { value: string; label: string }[] = [
  { value: "",           label: "All activity" },
  { value: "login",      label: "Sign-ins" },
  { value: "grade",      label: "Grades published" },
  { value: "submission", label: "AI grading drafts" },
  { value: "users",      label: "User imports" },
  { value: "unit_exam",  label: "Unit exams" },
  { value: "data",       label: "Data exports" },
];

const ACTION_LABELS: Record<string, string> = {
  "login.success": "Signed in",
  "login.denied": "Sign-in refused",
  "grade.submit": "Published a grade",
  "submission.ai_draft": "Generated an AI grading draft",
  "submission.ai_grade": "AI grading suggestion",
  "users.bulk_import": "Imported users",
  "unit_exam.create": "Created a unit exam",
  "unit_exam.upload_paper": "Uploaded an exam paper",
  "unit_exam.import_marks": "Imported exam marks",
  "data.export": "Exported data",
};

interface AuditRow {
  id: number;
  created_at: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
}

const PAGE_SIZE = 50;

export const AdminDataPage: React.FC = () => {
  const [busy, setBusy] = useState<Dataset | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getAuditLogs({
      action: action || undefined,
      since: since ? new Date(`${since}T00:00:00`).toISOString() : undefined,
      until: until ? new Date(`${until}T23:59:59.999`).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((d: any) => { setRows(Array.isArray(d?.rows) ? d.rows : []); setTotal(Number(d?.total ?? 0)); })
      .catch(() => toast.error("Could not load the audit log"))
      .finally(() => setLoading(false));
  }, [action, since, until, offset]);

  useEffect(() => { load(); }, [load]);

  const runExport = async (id: Dataset) => {
    setBusy(id);
    try {
      await downloadExport(id);
      toast.success("Export downloaded");
      load();   // the export itself is now in the audit log
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const describe = (r: AuditRow) => {
    const label = ACTION_LABELS[r.action] ?? r.action;
    return r.action === "data.export" && r.resource_id ? `${label}: ${r.resource_id}` : label;
  };

  return (
    <div className="space-y-8">
      <Toaster position="top-right" />
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Data &amp; Audit</h1>
        <p className="text-slate-500 mt-1">Export your college's records and review who did what.</p>
      </div>

      <section aria-labelledby="exports-heading" className="space-y-4">
        <h2 id="exports-heading" className="text-sm font-bold text-slate-400 uppercase tracking-widest">Export (CSV)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {EXPORTS.map(({ id, title, detail, icon: Icon }) => (
            <div key={id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900">{title}</h3>
              <p className="text-sm text-slate-500 mt-1 flex-1">{detail}</p>
              <button
                type="button"
                onClick={() => runExport(id)}
                disabled={busy !== null}
                className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                {busy === id ? "Preparing…" : "Download"}
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          Exports contain personal data. Each download is recorded in the audit log below. Opens in Excel or Google Sheets.
        </p>
      </section>

      <section aria-labelledby="audit-heading" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 mr-auto">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h2 id="audit-heading" className="font-bold text-slate-900">Audit log</h2>
          </div>
          <label className="text-xs font-semibold text-slate-500">
            Activity
            <select
              value={action}
              onChange={e => { setAction(e.target.value); setOffset(0); }}
              className="mt-1 block px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
            >
              {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            From
            <input type="date" value={since} max={until || undefined}
              onChange={e => { setSince(e.target.value); setOffset(0); }}
              className="mt-1 block px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            To
            <input type="date" value={until} min={since || undefined}
              onChange={e => { setUntil(e.target.value); setOffset(0); }}
              className="mt-1 block px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">When</th>
                <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Who</th>
                <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">What</th>
                <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Item</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-6 py-3 text-sm text-slate-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    <span className="text-slate-900">{r.actor_email ?? "System"}</span>
                    {r.actor_role && <span className="ml-2 text-xs text-slate-400 capitalize">{r.actor_role}</span>}
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-700">{describe(r)}</td>
                  <td className="px-6 py-3 text-sm text-slate-400">
                    {r.resource_type && r.action !== "data.export" ? `${r.resource_type} #${r.resource_id ?? ""}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No activity matches these filters.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-slate-100 text-sm text-slate-500">
          <span>{loading ? "Loading…" : total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}` : "0 entries"}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="px-4 py-2 rounded-xl border border-slate-200 font-semibold disabled:opacity-40">Previous</button>
            <button type="button" onClick={() => setOffset(o => o + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || loading}
              className="px-4 py-2 rounded-xl border border-slate-200 font-semibold disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdminDataPage;
