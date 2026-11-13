import React, { useEffect, useRef, useState } from "react";
import { X, Upload, Download, Mail, KeyRound, AlertTriangle } from "lucide-react";
import { api } from "../../services/api";

type Mode = "invite" | "temp_password";

interface PreviewRow { row: number; name: string; email: string; role: "student" | "instructor"; year: number | null; major: string | null }
interface Issue { row: number; email?: string; reason: string }
interface Preview {
  rows: PreviewRow[];
  issues: Issue[];
  counts: { total: number; valid: number; students: number; instructors: number; issues: number };
  batchSize: number;
}
type RowResult =
  | { row: number; email: string; status: "created"; tempPassword?: string; emailPending?: boolean }
  | { row: number; email: string; status: "exists" | "failed"; reason: string };

type Step = "upload" | "review" | "running" | "done";

const TEMPLATE = "name,email,role,year,department\nPriya R,priya.r@college.edu.in,student,2,CSE\nDr. Anand Kumar,anand.kumar@college.edu.in,instructor,,CSE\n";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote when needed, and neutralise spreadsheet formula injection.
  // (Temporary passwords always start with a letter or digit, so they pass unchanged.)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const text = [header, ...rows].map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Admin bulk import: upload → review (issues, mode) → create in batches with
 * progress → results. Temporary passwords exist only in this component's
 * memory and in the CSV the admin chooses to download.
 */
export const BulkImportDialog: React.FC<Props> = ({ onClose, onImported }) => {
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<Mode>("invite");
  const [results, setResults] = useState<RowResult[]>([]);
  const [done, setDone] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  const [downloadedPasswords, setDownloadedPasswords] = useState(false);
  const stopRef = useRef(false);

  const running = step === "running";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    if (running) return;
    if (results.some(r => r.status === "created" && r.tempPassword) && !downloadedPasswords &&
        !window.confirm("You haven't downloaded the temporary passwords. They can't be shown again. Close anyway?")) {
      return;
    }
    onClose();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const data: Preview = await api.previewUserImport(file);
      setPreview(data);
      setStep("review");
    } catch (e: any) {
      setError(e?.message || "Could not read the file.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!preview) return;
    stopRef.current = false;
    setStep("running");
    setResults([]);
    setDone(0);
    const all: RowResult[] = [];
    const size = preview.batchSize || 50;
    for (let i = 0; i < preview.rows.length; i += size) {
      if (stopRef.current) break;
      const batch = preview.rows.slice(i, i + size);
      try {
        const res: { results: RowResult[] } = await api.commitUserImport(mode, batch);
        all.push(...res.results);
      } catch (e: any) {
        // Keep going; the batch is reported as failed and can be re-imported (rows are idempotent).
        all.push(...batch.map(r => ({ row: r.row, email: r.email, status: "failed" as const, reason: e?.message || "Request failed" })));
      }
      setResults([...all]);
      setDone(Math.min(i + size, preview.rows.length));
    }
    setPending(all.filter(r => r.status === "created" && r.emailPending).map(r => r.email));
    setStep("done");
    onImported();
  }

  async function resendPending() {
    setBusy(true);
    setError("");
    let remaining = [...pending];
    try {
      while (remaining.length) {
        const batch = remaining.slice(0, 50);
        const res: { sent: string[]; pending: string[]; rateLimited: boolean } = await api.resendUserInvites(batch);
        remaining = [...res.pending, ...remaining.slice(50)];
        if (res.rateLimited) {
          setError("The email limit was reached. Try the remaining emails again later.");
          break;
        }
        if (!res.sent.length) break;
      }
    } catch (e: any) {
      setError(e?.message || "Could not send emails.");
    } finally {
      setPending(remaining);
      setBusy(false);
    }
  }

  const created = results.filter(r => r.status === "created");
  const exists = results.filter(r => r.status === "exists");
  const failed = results.filter(r => r.status === "failed");
  const total = preview?.rows.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-import-title"
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-ink shadow-2xl sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="bulk-import-title" className="text-2xl font-bold tracking-tight">Import users</h2>
            <p className="mt-1 text-sm text-muted">Add students and faculty from a spreadsheet. Admins are added one at a time.</p>
          </div>
          <button onClick={close} disabled={running} className="lp-focus rounded-lg p-2 text-muted hover:text-ink disabled:opacity-40" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-5 rounded-[10px] border border-pen/25 bg-[#FBEDEF] px-4 py-3 text-sm text-pen">{error}</p>
        )}

        {step === "upload" && (
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-rule bg-paper px-6 py-10 text-center hover:border-brand">
              <Upload className="mb-3 h-7 w-7 text-brand" aria-hidden="true" />
              <span className="font-semibold">{busy ? "Checking file…" : "Choose a .csv or .xlsx file"}</span>
              <span className="mt-1 text-sm text-muted">Up to 5,000 rows and 2 MB</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="sr-only"
                disabled={busy}
                onChange={e => handleFile(e.target.files?.[0])}
              />
            </label>
            <div className="mt-5 rounded-xl bg-paper p-4 text-sm leading-relaxed text-muted">
              <p>
                Columns: <strong className="text-ink">name</strong>, <strong className="text-ink">email</strong>, role
                (student or instructor; blank means student), year, department. Header spelling is flexible.
              </p>
              <button
                type="button"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
                  const a = document.createElement("a");
                  a.href = url; a.download = "learnit-users-template.csv"; a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                className="lp-focus mt-2 inline-flex items-center gap-1.5 rounded font-medium text-brand underline underline-offset-4"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Download template
              </button>
            </div>
          </div>
        )}

        {step === "review" && preview && (
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Ready", preview.counts.valid],
                ["Students", preview.counts.students],
                ["Faculty", preview.counts.instructors],
                ["Need attention", preview.counts.issues],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-xl border border-rule p-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className={`text-2xl font-bold ${label === "Need attention" && Number(n) > 0 ? "text-pen" : ""}`}>{Number(n).toLocaleString("en-IN")}</dd>
                </div>
              ))}
            </dl>

            {preview.issues.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Rows that will be skipped</h3>
                  <button
                    type="button"
                    className="lp-focus text-sm font-medium text-brand underline underline-offset-4"
                    onClick={() => downloadCsv("import-issues.csv", ["row", "email", "reason"], preview.issues.map(i => [i.row, i.email ?? "", i.reason]))}
                  >
                    Download list
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-rule">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-paper text-xs text-muted">
                      <tr><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Reason</th></tr>
                    </thead>
                    <tbody>
                      {preview.issues.slice(0, 100).map((i, k) => (
                        <tr key={k} className="border-t border-rule">
                          <td className="px-3 py-2 tabular-nums text-muted">{i.row || "—"}</td>
                          <td className="px-3 py-2">{i.email || "—"}</td>
                          <td className="px-3 py-2">{i.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {preview.counts.valid > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">How should people get their first sign-in?</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["invite", Mail, "Email a set-password link", "Each person sets their own password from an email. No passwords to hand out. Emails go out at your email plan's hourly limit; any that wait can be sent from the results screen."],
                    ["temp_password", KeyRound, "Temporary passwords", "You download a CSV of one-time passwords to share. Accounts work immediately; people must change the password at first sign-in."],
                  ] as const).map(([value, Icon, title, body]) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-xl border-2 p-4 focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 ${mode === value ? "border-brand bg-brand-50" : "border-rule hover:border-brand-300"}`}
                    >
                      <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                      <span className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-brand" aria-hidden="true" />{title}</span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-muted">{body}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => { setPreview(null); setStep("upload"); }} className="lp-focus lp-btn-ghost">Choose another file</button>
              <button type="button" disabled={!preview.counts.valid} onClick={runImport} className="lp-focus lp-btn">
                Create {preview.counts.valid.toLocaleString("en-IN")} account{preview.counts.valid === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "running" && (
          <div className="py-4">
            <p className="font-semibold" role="status">Creating accounts… {done.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</p>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-rule" aria-hidden="true">
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className="mt-3 text-sm text-muted">Keep this window open. Large colleges take a few minutes.</p>
            <button type="button" onClick={() => { stopRef.current = true; }} className="lp-focus lp-btn-ghost mt-5">
              Stop after this batch
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-5">
            <dl className="grid grid-cols-3 gap-3">
              {[["Created", created.length], ["Already had accounts", exists.length], ["Failed", failed.length]].map(([label, n]) => (
                <div key={label as string} className="rounded-xl border border-rule p-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className={`text-2xl font-bold ${label === "Failed" && Number(n) > 0 ? "text-pen" : ""}`}>{Number(n).toLocaleString("en-IN")}</dd>
                </div>
              ))}
            </dl>

            {mode === "temp_password" && created.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                <p className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Download the temporary passwords now. They are not stored anywhere and can't be shown again. Share the file only
                  through your college's secure channels, and delete it once everyone has signed in.
                </p>
                <button
                  type="button"
                  className="lp-focus lp-btn mt-3"
                  onClick={() => {
                    downloadCsv(
                      "learnit-temporary-passwords.csv",
                      ["email", "temporary_password"],
                      created.map(r => [r.email, r.status === "created" ? r.tempPassword ?? "" : ""]),
                    );
                    setDownloadedPasswords(true);
                  }}
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Download passwords (CSV)
                </button>
              </div>
            )}

            {mode === "invite" && created.length > 0 && (
              <p className="text-sm leading-relaxed text-muted">
                {pending.length === 0
                  ? "Set-password emails have been sent. Links expire after an hour; anyone who misses it can use “Forgot your password?” on the sign-in page."
                  : `${(created.length - pending.length).toLocaleString("en-IN")} emails sent. ${pending.length.toLocaleString("en-IN")} are waiting because the hourly email limit was reached.`}
              </p>
            )}
            {pending.length > 0 && (
              <button type="button" disabled={busy} onClick={resendPending} className="lp-focus lp-btn">
                <Mail className="h-4 w-4" aria-hidden="true" /> {busy ? "Sending…" : `Send ${pending.length.toLocaleString("en-IN")} waiting emails`}
              </button>
            )}

            {(failed.length > 0 || exists.length > 0) && (
              <button
                type="button"
                className="lp-focus block text-sm font-medium text-brand underline underline-offset-4"
                onClick={() => downloadCsv("import-skipped.csv", ["row", "email", "status", "reason"],
                  [...exists, ...failed].map(r => [r.row, r.email, r.status, r.status === "created" ? "" : r.reason]))}
              >
                Download skipped and failed rows
              </button>
            )}
            {failed.length > 0 && (
              <p className="text-sm text-muted">Fix the failed rows and import that file again; accounts that were created are skipped automatically.</p>
            )}

            <div className="flex justify-end">
              <button type="button" onClick={close} className="lp-focus lp-btn-ghost">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
