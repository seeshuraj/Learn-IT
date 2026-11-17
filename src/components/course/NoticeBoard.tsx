import React, { useEffect, useState } from 'react';
import { BellRing, BookOpenCheck, Loader2, Megaphone, Package, Pencil, Pin, Trash2 } from 'lucide-react';
import { api, type CourseNotice, type NoticeKind } from '../../services/api';
import { dueLabel } from '../../server/lib/courseNotices';

/**
 * A course's notice board: what to bring, what to prepare, announcements.
 * The course's professor posts, edits and removes notices; students of the
 * course see them here and get a notification when one is posted.
 */

export const KINDS: { kind: NoticeKind; label: string; icon: React.ElementType; tone: string }[] = [
  { kind: 'notice',    label: 'Notice',    icon: Megaphone,     tone: 'bg-indigo-50 text-indigo-700' },
  { kind: 'bring',     label: 'Bring',     icon: Package,       tone: 'bg-amber-50 text-amber-800' },
  { kind: 'exam_prep', label: 'Prepare',   icon: BookOpenCheck, tone: 'bg-rose-50 text-rose-700' },
  { kind: 'reminder',  label: 'Reminder',  icon: BellRing,      tone: 'bg-teal-50 text-teal-700' },
];
const kindOf = (k: NoticeKind) => KINDS.find(x => x.kind === k) ?? KINDS[0];

export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';

function NoticeForm({ initial, onCancel, onSubmit, submitLabel }: {
  initial?: CourseNotice;
  onCancel?: () => void;
  onSubmit: (n: { kind: NoticeKind; title: string; body: string | null; due_date: string | null; pinned: boolean }) => Promise<void>;
  submitLabel: string;
}) {
  const [kind, setKind] = useState<NoticeKind>(initial?.kind ?? 'notice');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [due, setDue] = useState(initial?.due_date ?? '');
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = todayIst();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Write what the notice is about'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit({ kind, title: title.trim(), body: body.trim() || null, due_date: due || null, pinned });
      if (!initial) { setTitle(''); setBody(''); setDue(''); setPinned(false); setKind('notice'); }
    } catch (err: any) {
      setError(err.message || 'Could not save the notice');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of notice">
        {KINDS.map(k => (
          <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              kind === k.kind ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'
            }`}>
            <k.icon className="h-3.5 w-3.5" /> {k.label}
          </button>
        ))}
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={field} aria-label="Notice"
        placeholder={kind === 'bring' ? 'Drawing kit and mini-drafter' : kind === 'exam_prep' ? 'Unit 2 for Thursday’s test' : 'Class moved to Lab 3'} />
      <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={4000} rows={2} className={field}
        aria-label="Details (optional)" placeholder="Details (optional)" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">For</span>
        {[{ d: today, l: 'Today' }, { d: addDays(today, 1), l: 'Tomorrow' }].map(o => (
          <button key={o.l} type="button" onClick={() => setDue(due === o.d ? '' : o.d)} aria-pressed={due === o.d}
            className={`rounded-lg border px-2.5 py-1 text-sm ${due === o.d ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600'}`}>
            {o.l}
          </button>
        ))}
        <input type="date" value={due} min={initial ? undefined : today} onChange={e => setDue(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm" aria-label="Date the notice is for" />
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
          Pin to top
        </label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="px-3 py-2 text-sm font-medium text-slate-600">Cancel</button>}
        <button type="submit" disabled={busy || !title.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {submitLabel}
        </button>
      </div>
    </form>
  );
}

function NoticeItem({ n, canManage, onSaved, onDeleted }: {
  n: CourseNotice; canManage: boolean; onSaved: (n: CourseNotice) => void; onDeleted: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const k = kindOf(n.kind);
  const when = dueLabel(n.due_date, todayIst());

  if (editing) {
    return (
      <li className="rounded-2xl border border-indigo-200 bg-white p-4">
        <NoticeForm initial={n} submitLabel="Save" onCancel={() => setEditing(false)}
          onSubmit={async v => { onSaved(await api.updateCourseNotice(n.id, v)); setEditing(false); }} />
      </li>
    );
  }
  return (
    <li className={`rounded-2xl border bg-white p-4 ${n.pinned ? 'border-indigo-200' : 'border-slate-200'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${k.tone}`}>
          <k.icon className="h-3.5 w-3.5" /> {k.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">
            {n.title}
            {n.pinned && <Pin className="ml-1.5 inline h-3.5 w-3.5 -rotate-45 text-indigo-500" aria-label="Pinned" />}
          </p>
          {n.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{n.body}</p>}
          <p className="mt-1.5 text-xs text-slate-500">
            {when && <span className="mr-2 font-semibold text-slate-700">For {when}</span>}
            {n.author_name ?? 'Your professor'} · {new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        </div>
        {canManage && !confirming && (
          <div className="flex shrink-0 gap-1">
            <button onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit “${n.title}”`}>
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => setConfirming(true)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove “${n.title}”`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm" role="alertdialog" aria-label="Remove notice">
          <span className="mr-auto text-slate-700">Remove this notice for everyone?</span>
          <button onClick={() => setConfirming(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600">Keep</button>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await api.deleteCourseNotice(n.id); onDeleted(n.id); } finally { setBusy(false); } }}
            className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60">Remove</button>
        </div>
      )}
    </li>
  );
}

export function NoticeBoard({ courseId, canManage, studentCount }: { courseId: number; canManage: boolean; studentCount: number }) {
  const [notices, setNotices] = useState<CourseNotice[] | null>(null);
  const [error, setError] = useState('');
  const [posted, setPosted] = useState('');
  const [showEarlier, setShowEarlier] = useState(false);

  useEffect(() => {
    let live = true;
    api.getCourseNotices(courseId)
      .then(n => { if (live) setNotices(Array.isArray(n) ? n : []); })
      .catch(e => { if (live) { setNotices([]); setError(e.message || 'Could not load notices'); } });
    return () => { live = false; };
  }, [courseId]);

  const today = todayIst();
  const list = notices ?? [];
  const current = list.filter(n => n.pinned || !n.due_date || n.due_date >= today);
  const earlier = list.filter(n => !n.pinned && n.due_date && n.due_date < today);
  const replace = (n: CourseNotice) => setNotices(prev => (prev ?? []).map(x => (x.id === n.id ? n : x)));
  const remove = (id: number) => setNotices(prev => (prev ?? []).filter(x => x.id !== id));

  return (
    <section className="space-y-3" aria-labelledby="notices-title">
      <h2 id="notices-title" className="text-xl font-bold text-slate-900">Notice board</h2>

      {canManage && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <NoticeForm submitLabel="Post notice" onSubmit={async v => {
            const n = await api.postCourseNotice(courseId, v);
            setNotices(prev => [n, ...(prev ?? [])]);
            setPosted(`Posted. ${n.notified ?? studentCount} ${(n.notified ?? studentCount) === 1 ? 'student was' : 'students were'} notified.`);
          }} />
          {posted && <p className="mt-2 text-sm text-emerald-700" role="status">{posted}</p>}
        </div>
      )}

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notices === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading notices…</p>
      ) : current.length === 0 && earlier.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-6 text-center text-sm text-slate-600">
          {canManage ? 'Post what students should bring, prepare or know. They’ll be notified.' : 'No notices from your professor yet.'}
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {current.map(n => <NoticeItem key={n.id} n={n} canManage={canManage} onSaved={replace} onDeleted={remove} />)}
          </ul>
          {earlier.length > 0 && (
            <div>
              <button onClick={() => setShowEarlier(s => !s)} aria-expanded={showEarlier} className="text-sm font-semibold text-indigo-600 hover:underline">
                {showEarlier ? 'Hide earlier notices' : `Earlier notices (${earlier.length})`}
              </button>
              {showEarlier && (
                <ul className="mt-3 space-y-3 opacity-80">
                  {earlier.map(n => <NoticeItem key={n.id} n={n} canManage={canManage} onSaved={replace} onDeleted={remove} />)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
