import React, { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2 } from "lucide-react";
import { api, type SearchResults } from "../services/api";

/**
 * The search box in the top bar. Finds courses, assignments and notes the
 * person can open (admins also find people) and goes straight to them.
 * Keyboard: arrows move, Enter opens, Escape closes.
 */

interface Hit { key: string; group: string; label: string; detail?: string; to: string }

function toHits(r: SearchResults, role: string | undefined): Hit[] {
  const hits: Hit[] = [];
  for (const c of r.courses) hits.push({ key: `c${c.id}`, group: "Courses", label: c.name, detail: c.code ?? undefined, to: `/courses/${c.id}` });
  for (const a of r.assignments) hits.push({
    key: `a${a.id}`, group: "Assignments", label: a.title, detail: a.course_code ?? undefined,
    to: role === "student" ? `/assignments?id=${a.id}` : `/courses/${a.course_id}`,
  });
  for (const n of r.notes) hits.push({ key: `n${n.id}`, group: "Notes", label: n.name, detail: [n.course_code, n.module_name].filter(Boolean).join(" · "), to: `/notes?module=${n.module_id}` });
  for (const p of r.people) hits.push({ key: `p${p.id}`, group: "People", label: p.name, detail: p.email, to: `/admin/users?q=${encodeURIComponent(p.email)}` });
  return hits;
}

export const GlobalSearch: React.FC<{ role?: string }> = ({ role }) => {
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced lookup; a newer query cancels an older answer.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); setFailed(false); return; }
    let stale = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(term)
        .then(r => { if (!stale) { setHits(toHits(r, role)); setActive(0); setFailed(false); } })
        .catch(() => { if (!stale) { setHits([]); setFailed(true); } })
        .finally(() => { if (!stale) setLoading(false); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [q, role]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (h: Hit) => { setOpen(false); setQ(""); navigate(h.to); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(i => (i + 1) % hits.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (i - 1 + hits.length) % hits.length); }
    if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
  };

  const term = q.trim();
  const show = open && term.length >= 2;
  const placeholder = role === "admin" ? "Search courses, people, assignments or notes" : "Search courses, assignments or notes";

  return (
    <div className="relative w-full" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" aria-hidden="true" />
      <input
        type="search"
        role="combobox"
        aria-label="Search"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && hits[active] ? `${listId}-${hits[active].key}` : undefined}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="w-full pl-10 pr-9 py-2 bg-white border border-rule rounded-[10px] text-sm text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition-colors"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted" aria-hidden="true" />}
      {show && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-rule bg-white py-2 shadow-lg">
          {failed ? (
            <p className="px-4 py-3 text-sm text-muted">Search isn't available right now. Try again in a moment.</p>
          ) : !loading && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Nothing matches “{term}”.</p>
          ) : (
            hits.map((h, i) => (
              <React.Fragment key={h.key}>
                {(i === 0 || hits[i - 1].group !== h.group) && (
                  <p className="px-4 pb-1 pt-2 text-xs font-semibold text-muted">{h.group}</p>
                )}
                <button
                  id={`${listId}-${h.key}`}
                  role="option"
                  aria-selected={i === active}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm ${i === active ? "bg-slate-100" : ""}`}
                >
                  <span className="truncate font-medium text-ink">{h.label}</span>
                  {h.detail && <span className="shrink-0 truncate text-xs text-muted">{h.detail}</span>}
                </button>
              </React.Fragment>
            ))
          )}
        </div>
      )}
    </div>
  );
};
