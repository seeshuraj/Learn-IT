/**
 * iCalendar (RFC 5545) for exam schedules. Times in timetables are Indian
 * Standard Time (no daylight saving), written out in UTC so every calendar
 * app shows them correctly wherever the phone is.
 */

import { SESSION_TIMES } from './timetable.js';

export interface CalendarExam {
  id: number;                 // timetable entry id: stable UID across updates
  exam_date: string;          // YYYY-MM-DD
  session: 'FN' | 'AN' | null;
  start_time: string | null;  // HH:MM IST
  end_time: string | null;
  course_code: string | null;
  course_name: string | null;
  title: string;              // "Unit test 2"
  venue: string | null;
  updated_at?: string | Date | null;
}

const IST_OFFSET_MIN = 330;

/** YYYY-MM-DD + HH:MM in IST → 20261202T040000Z. */
export function istToUtcStamp(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000);
  return t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Escape TEXT values. */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (continuation lines start with a space). */
export function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

/** Start/end for an exam: its own times, else the session's usual times, else all day. */
export function examTimes(e: Pick<CalendarExam, 'session' | 'start_time' | 'end_time'>): { start: string; end: string } | null {
  if (e.start_time) {
    const fallbackEnd = (() => {
      const [h, m] = e.start_time.split(':').map(Number);
      const mins = h * 60 + m + 180;
      return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    })();
    return { start: e.start_time, end: e.end_time ?? fallbackEnd };
  }
  if (e.session) return SESSION_TIMES[e.session];
  return null;
}

export function buildCalendar(exams: CalendarExam[], opts: { name: string; now?: Date; host?: string }): string {
  const now = opts.now ?? new Date();
  const host = opts.host ?? 'learnitanalytics.com';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LearnIT Analytics//Exams//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(opts.name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of exams) {
    const label = [e.course_code, e.title].filter(Boolean).join(' ');
    const times = examTimes(e);
    const day = e.exam_date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:exam-${e.id}@${host}`, `DTSTAMP:${stamp(now)}`);
    if (e.updated_at) lines.push(`LAST-MODIFIED:${stamp(new Date(e.updated_at))}`);
    if (times) {
      lines.push(`DTSTART:${istToUtcStamp(e.exam_date, times.start)}`, `DTEND:${istToUtcStamp(e.exam_date, times.end)}`);
    } else {
      const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`);
    }
    lines.push(`SUMMARY:${icsText(label || 'Exam')}`);
    const desc = [e.course_name, e.session && !e.start_time ? `Session ${e.session} (time not given; check the timetable)` : null].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
    if (e.venue) lines.push(`LOCATION:${icsText(e.venue)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Tomorrow: ${label || 'exam'}`)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
