/**
 * Course notice board: validating what a professor posts, and the wording of
 * the notification students get. Pure functions (tested).
 */

export const NOTICE_KINDS = ['notice', 'bring', 'exam_prep', 'reminder'] as const;
export type NoticeKind = typeof NOTICE_KINDS[number];

export interface NoticeValues {
  kind: NoticeKind;
  title: string;
  body: string | null;
  due_date: string | null;
  pinned: boolean;
}

const KIND_WORD: Record<NoticeKind, string> = {
  notice: 'Notice',
  bring: 'Bring',
  exam_prep: 'Prepare',
  reminder: 'Reminder',
};

const realDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Validate a notice from a request body. `partial` = an edit (only sent fields). */
export function readNotice(body: any, partial: boolean): { values: Partial<NoticeValues> } | { error: string } {
  const b = body ?? {};
  const has = (k: string) => b[k] !== undefined;
  const out: Partial<NoticeValues> = {};

  if (!partial || has('kind')) {
    const kind = b.kind ?? 'notice';
    if (!(NOTICE_KINDS as readonly string[]).includes(kind)) return { error: 'Choose what kind of notice this is' };
    out.kind = kind;
  }
  if (!partial || has('title')) {
    const title = String(b.title ?? '').trim().replace(/\s+/g, ' ');
    if (!title) return { error: 'Write what the notice is about' };
    if (title.length > 200) return { error: 'Keep the title under 200 characters; put details below it' };
    out.title = title;
  }
  if (!partial || has('body')) {
    const text = String(b.body ?? '').trim();
    if (text.length > 4000) return { error: 'Details can be up to 4000 characters' };
    out.body = text || null;
  }
  if (!partial || has('due_date')) {
    const d = b.due_date === null || b.due_date === undefined || b.due_date === '' ? null : String(b.due_date);
    if (d !== null && !realDate(d)) return { error: 'Pick a valid date' };
    out.due_date = d;
  }
  if (!partial || has('pinned')) out.pinned = b.pinned === true;
  return { values: out };
}

/** "today", "tomorrow", or "Sat 21 Nov" for a due date, relative to today (YYYY-MM-DD, IST). */
export function dueLabel(due: string | null, today: string): string | null {
  if (!due) return null;
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return new Date(`${due}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
}

/** The bell's line for a new notice: "CS3200 · Bring tomorrow: Drawing kit". */
export function noticeMessage(n: { code: string | null; kind: NoticeKind; title: string; due_date: string | null }, today: string): string {
  const when = dueLabel(n.due_date, today);
  const word = KIND_WORD[n.kind];
  const lead = when ? (n.kind === 'notice' ? `${word} for ${when}` : `${word} ${when === 'today' || when === 'tomorrow' ? when : `by ${when}`}`) : word;
  return `${n.code ? `${n.code} · ` : ''}${lead}: ${n.title}`.slice(0, 300);
}
