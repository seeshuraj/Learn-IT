import React, { useEffect } from "react";
import { Link } from "react-router-dom";

/**
 * Public landing page for colleges.
 *
 * Visual idea: an engineering student's marked unit test. The hero shows the
 * examiner's red-pen annotation explaining *why* marks were lost, followed by
 * the study plan LearnIT produces. Red ink is reserved for annotations only;
 * ballpoint blue carries actions; the graph-sheet grid appears only on the
 * answer sheet.
 */

const PILOT_MAILTO =
  "mailto:contact@learnitanalytics.com" +
  "?subject=" + encodeURIComponent("LearnIT pilot for our college") +
  "&body=" + encodeURIComponent(
    "College name:\nDepartment(s):\nApproximate number of students:\nPreferred start (semester):\n",
  );

const MARKS = [
  { q: "Q1", topic: "Linked lists", got: 9 },
  { q: "Q2", topic: "Stacks and queues", got: 8 },
  { q: "Q3", topic: "Tree traversal", got: 3, flagged: true },
  { q: "Q4", topic: "Hashing", got: 7 },
  { q: "Q5", topic: "Graph search", got: 5 },
];

const PLAN = [
  "Re-read Module 3, Lecture 7 notes on tree traversal",
  "Practise five inorder and preorder questions",
  "Ask the tutor why postorder visits the root last",
];

const ROLES = [
  {
    who: "Students",
    line: "Know what to study, not only what you scored.",
    body:
      "See the weak topics from every unit test, follow a weekly study plan, and ask an AI tutor that answers from the notes your faculty uploaded.",
  },
  {
    who: "Faculty",
    line: "Spend the hours on teaching, not tallying.",
    body:
      "Upload marks from a spreadsheet, see which topics the class missed, and get AI-drafted feedback on submissions that you approve or edit before students see it.",
  },
  {
    who: "Heads of department and principals",
    line: "See where every course stands.",
    body:
      "Course performance, late submissions and students who need attention, across the departments in your institution, in one place.",
  },
];

const STEPS = [
  {
    title: "Marks go in",
    body: "Faculty upload unit test marks as a CSV or Excel sheet, with topic-wise scores if they have them.",
  },
  {
    title: "Weak topics surface",
    body: "LearnIT compares each student against your grading scheme and marks every topic as strong, moderate or weak.",
  },
  {
    title: "Each student gets a plan",
    body: "A step-by-step study roadmap, and a tutor that answers from the course notes, not from the open internet.",
  },
  {
    title: "Faculty stay in charge",
    body: "AI drafts feedback on assignments. A grade becomes final only when a faculty member saves it.",
  },
];

const COMMITMENTS = [
  {
    title: "Each college's data is kept separate",
    body: "Every record belongs to one institution, and the database itself rejects any link between institutions.",
  },
  {
    title: "AI never finalises a grade",
    body: "Suggested scores and feedback are drafts. Faculty review, edit and save every grade.",
  },
  {
    title: "Course files stay private",
    body: "Notes and submissions are stored privately and opened through links that expire within minutes.",
  },
  {
    title: "Grading is on the record",
    body: "Sign-ins and grading actions are written to an audit log your administrators can review.",
  },
];

// Per enrolled student, per semester. USD shown at about ₹95 = US$1.
const TIERS = [
  {
    name: "LMS",
    inr: "₹300",
    usd: "about US$3",
    fit: "For colleges moving coursework online.",
    lead: "Includes",
    items: [
      "Courses, modules and course notes",
      "Assignments, submissions and grading",
      "Unit test marks import from CSV or Excel",
      "Student, faculty and admin dashboards",
    ],
  },
  {
    name: "LMS + AI tutor",
    inr: "₹2,000",
    usd: "about US$21",
    fit: "For colleges that want students supported between classes.",
    lead: "Everything in LMS, plus",
    items: [
      "AI tutor that answers from your course notes",
      "AI-written progress summaries for each student",
    ],
  },
  {
    name: "Full academic intelligence",
    inr: "₹8,000",
    usd: "about US$84",
    fit: "For colleges that want every student on a personal plan.",
    lead: "Everything in LMS + AI tutor, plus",
    items: [
      "Weak-topic detection from every unit test",
      "Personal study roadmaps for each student",
      "AI-drafted grading feedback, approved by faculty",
      "Topic analysis of exam papers",
    ],
  },
];

/** Loads the two landing-page typefaces only on this page. */
function useLandingFonts() {
  useEffect(() => {
    const id = "lp-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(link);
  }, []);
}

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-md" />
      <span className="text-[17px] font-bold tracking-tight">LearnIT</span>
    </span>
  );
}

/** The marked answer sheet: the page's one bold element. */
function MarkedSheet() {
  const total = MARKS.reduce((n, m) => n + m.got, 0);
  return (
    <figure className="lp-sheet relative w-full" aria-label="Example: a marked unit test and the study plan LearnIT creates from it">
      <div className="lp-grid rounded-[14px] border border-[var(--rule)] bg-white p-5 shadow-[0_1px_0_var(--rule),0_24px_48px_-28px_rgba(19,32,59,0.35)] sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-[var(--ink)] pb-3">
          <p className="text-[15px] font-semibold">Unit Test 2, Data Structures</p>
          <p className="text-[13px] text-[var(--muted)]">Priya R., II year CSE</p>
        </div>

        <div className="grid gap-x-6 sm:grid-cols-[1fr_auto]">
          <table className="mt-1 w-full border-collapse text-[14px]">
            <caption className="sr-only">Marks by question</caption>
            <thead>
              <tr className="text-left text-[12px] text-[var(--muted)]">
                <th scope="col" className="py-2 pr-3 font-medium">Question</th>
                <th scope="col" className="py-2 pr-3 font-medium">Topic</th>
                <th scope="col" className="py-2 text-right font-medium">Marks</th>
              </tr>
            </thead>
            <tbody>
              {MARKS.map(m => (
                <tr key={m.q} className="border-t border-[var(--rule)]">
                  <td className="py-2.5 pr-3 text-[var(--muted)]">{m.q}</td>
                  <td className={`py-2.5 pr-3 ${m.flagged ? "lp-underline relative" : ""}`}>
                    {m.topic}
                    {m.flagged && (
                      <svg className="lp-stroke pointer-events-none absolute -bottom-0.5 left-0 h-2 w-[7.5rem]" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M1 5 C 30 2, 60 7, 119 3" pathLength={1} />
                      </svg>
                    )}
                  </td>
                  <td className="lp-num py-2.5 text-right">
                    {m.flagged ? (
                      <span className="relative inline-block px-1.5">
                        {m.got}/10
                        <svg className="lp-stroke pointer-events-none absolute -inset-x-2 -inset-y-2 h-[calc(100%+16px)] w-[calc(100%+16px)]" viewBox="0 0 60 36" preserveAspectRatio="none" aria-hidden="true">
                          <path d="M48 6 C 30 -1, 6 3, 4 17 C 3 31, 40 35, 54 24 C 61 17, 57 8, 44 5" pathLength={1} />
                        </svg>
                      </span>
                    ) : (
                      `${m.got}/10`
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--ink)] font-semibold">
                <td className="py-2.5" colSpan={2}>Total</td>
                <td className="lp-num py-2.5 text-right">{total}/50</td>
              </tr>
            </tbody>
          </table>

          {/* Examiner's margin note (beside the table on wide screens, below it on phones) */}
          <p className="lp-note lp-hand mt-3 max-w-[15rem] text-[22px] leading-[1.1] text-[var(--red)] sm:mt-[6.5rem] sm:w-[10.5rem]">
            Mixed up traversal order in all three parts. Revise Module 3.
          </p>
        </div>
      </div>

      {/* What LearnIT does with it */}
      <figcaption className="lp-plan relative -mt-3 ml-auto w-[92%] rounded-[14px] border border-[var(--rule)] bg-[var(--paper)] p-5 sm:-mt-6 sm:w-[82%]">
        <p className="text-[14px] font-semibold">This week's plan for Priya</p>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">Built from Unit Test 2 and her course notes</p>
        <ul className="mt-3 space-y-2 text-[14px]">
          {PLAN.map(item => (
            <li key={item} className="flex gap-2.5">
              <span className="mt-[5px] h-3 w-3 shrink-0 rounded-[3px] border-[1.5px] border-[var(--blue)]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  useLandingFonts();

  return (
    <div className="lp min-h-screen bg-[var(--paper)] text-[var(--ink)] antialiased">
      <style>{LANDING_CSS}</style>

      <a href="#main" className="lp-skip">Skip to content</a>

      <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[72rem] items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/landing" className="lp-focus rounded-md" aria-label="LearnIT home">
            <Logo />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            <a href="#how" className="lp-focus hidden rounded-md px-3 py-2 text-[15px] text-[var(--muted)] hover:text-[var(--ink)] md:inline-block">How it works</a>
            <a href="#trust" className="lp-focus hidden rounded-md px-3 py-2 text-[15px] text-[var(--muted)] hover:text-[var(--ink)] md:inline-block">Data and privacy</a>
            <a href="#pricing" className="lp-focus hidden rounded-md px-3 py-2 text-[15px] text-[var(--muted)] hover:text-[var(--ink)] md:inline-block">Pricing</a>
            <Link to="/login" className="lp-focus whitespace-nowrap rounded-md px-2 py-2 text-[15px] font-medium hover:text-[var(--blue)] sm:px-3">Sign in</Link>
            <a href={PILOT_MAILTO} className="lp-focus lp-btn whitespace-nowrap">Book a pilot</a>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-[72rem] items-center gap-12 px-4 pb-20 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-28 lg:pt-24">
          <div className="max-w-[36rem]">
            <h1 className="lp-display text-[clamp(2.6rem,7vw,4.5rem)] font-extrabold leading-[0.98] tracking-[-0.035em]">
              Every mark, explained.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[clamp(1.05rem,2vw,1.2rem)] leading-[1.6] text-[var(--muted)]">
              LearnIT is a learning platform for Indian engineering colleges. It reads unit test results,
              finds the topics each student is weak in, and builds a study plan from your own course
              notes, with faculty in charge of every grade.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={PILOT_MAILTO} className="lp-focus lp-btn lp-btn-lg">Book a pilot</a>
              <Link to="/login" className="lp-focus lp-btn-ghost lp-btn-lg">Sign in to LearnIT</Link>
            </div>
            <p className="mt-5 text-[14px] text-[var(--muted)]">
              Pilots run for one semester with one or two courses.
            </p>
          </div>

          <MarkedSheet />
        </section>

        {/* Roles */}
        <section aria-labelledby="roles-h" className="border-t border-[var(--rule)] bg-white">
          <div className="mx-auto max-w-[72rem] px-4 py-20 sm:px-6 lg:py-28">
            <h2 id="roles-h" className="lp-display max-w-[40rem] text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.025em]">
              What changes for each person on campus
            </h2>
            <div className="mt-12 grid gap-y-10 md:grid-cols-3 md:gap-x-10">
              {ROLES.map(r => (
                <div key={r.who} className="border-t-2 border-[var(--ink)] pt-5">
                  <h3 className="text-[15px] font-semibold text-[var(--muted)]">{r.who}</h3>
                  <p className="mt-2 text-[21px] font-semibold leading-[1.25] tracking-[-0.01em]">{r.line}</p>
                  <p className="mt-3 max-w-[34rem] text-[16px] leading-[1.6] text-[var(--muted)]">{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The loop: a real sequence, so it is numbered */}
        <section id="how" aria-labelledby="how-h" className="border-t border-[var(--rule)]">
          <div className="mx-auto max-w-[72rem] px-4 py-20 sm:px-6 lg:py-28">
            <h2 id="how-h" className="lp-display max-w-[40rem] text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.025em]">
              From a unit test to a study plan
            </h2>
            <p className="mt-4 max-w-[38rem] text-[17px] leading-[1.6] text-[var(--muted)]">
              It fits the assessments you already run. Nothing changes about how you set or mark papers.
            </p>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-[14px] border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="bg-[var(--paper)] p-6 lg:p-7">
                  <span className="lp-num text-[15px] font-semibold text-[var(--blue)]" aria-hidden="true">{i + 1}</span>
                  <h3 className="mt-6 text-[19px] font-semibold leading-[1.25] tracking-[-0.01em]">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-[1.6] text-[var(--muted)]">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Data and privacy */}
        <section id="trust" aria-labelledby="trust-h" className="border-t border-[var(--rule)] bg-white">
          <div className="mx-auto grid max-w-[72rem] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:py-28">
            <div>
              <h2 id="trust-h" className="lp-display text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.025em]">
                Built for how colleges handle student data
              </h2>
              <p className="mt-4 max-w-[30rem] text-[17px] leading-[1.6] text-[var(--muted)]">
                Marks and submissions are sensitive. These are the rules LearnIT is built on.
              </p>
            </div>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {COMMITMENTS.map(c => (
                <div key={c.title}>
                  <dt className="text-[18px] font-semibold leading-[1.3]">{c.title}</dt>
                  <dd className="mt-2 text-[15px] leading-[1.6] text-[var(--muted)]">{c.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-h" className="border-t border-[var(--rule)]">
          <div className="mx-auto max-w-[72rem] px-4 py-20 sm:px-6 lg:py-28">
            <h2 id="pricing-h" className="lp-display max-w-[40rem] text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.025em]">
              Priced per student, per semester
            </h2>
            <p className="mt-4 max-w-[38rem] text-[17px] leading-[1.6] text-[var(--muted)]">
              You pay each semester for the students enrolled that semester. Start on any plan and move up when your faculty are ready.
            </p>
            <div className="mt-12 grid gap-y-12 md:grid-cols-3 md:gap-x-10">
              {TIERS.map(t => (
                <div key={t.name} className="flex flex-col border-t-2 border-[var(--ink)] pt-5">
                  <h3 className="text-[17px] font-semibold">{t.name}</h3>
                  <p className="lp-num mt-4 text-[clamp(2.4rem,5vw,3.25rem)] font-extrabold leading-none tracking-[-0.03em]">{t.inr}</p>
                  <p className="mt-2 text-[15px] text-[var(--muted)]">per student, per semester ({t.usd})</p>
                  <p className="mt-4 text-[16px] leading-[1.5]">{t.fit}</p>
                  <p className="mt-5 text-[14px] font-medium text-[var(--muted)]">{t.lead}</p>
                  <ul className="mt-2 space-y-2 text-[15px] leading-[1.5]">
                    {t.items.map(item => (
                      <li key={item} className="flex gap-2.5">
                        <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--blue)]" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-12 max-w-[40rem] text-[14px] leading-[1.6] text-[var(--muted)]">
              US dollar amounts are approximate. Pilot terms are agreed with each college before the semester starts.
            </p>
          </div>
        </section>

        {/* Pilot */}
        <section aria-labelledby="pilot-h" className="bg-[var(--ink)] text-white">
          <div className="mx-auto grid max-w-[72rem] gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1.3fr_1fr] md:items-end lg:py-24">
            <div>
              <h2 id="pilot-h" className="lp-display text-[clamp(2rem,4.5vw,3.25rem)] font-bold leading-[1.04] tracking-[-0.03em]">
                Start with one department for one semester.
              </h2>
              <p className="mt-5 max-w-[34rem] text-[17px] leading-[1.6] text-white/75">
                We set up your college and accounts, and run LearnIT alongside your current process for one
                or two courses. You see the results before deciding on a wider rollout.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <a href={PILOT_MAILTO} className="lp-focus-dark lp-btn-light lp-btn-lg">Book a pilot</a>
              <a href="mailto:contact@learnitanalytics.com" className="lp-focus-dark rounded-md text-[15px] text-white/75 underline underline-offset-4 hover:text-white">
                contact@learnitanalytics.com
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--rule)]">
        <div className="mx-auto flex max-w-[72rem] flex-col gap-4 px-4 py-8 text-[14px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} LearnIT Analytics Pvt Ltd</p>
          <Link to="/login" className="lp-focus rounded-md hover:text-[var(--ink)]">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}

const LANDING_CSS = `
.lp {
  --paper: #F6F8FB;
  --ink:   #13203B;
  --blue:  #2448B8;
  --red:   #C8102E;
  --rule:  #D9E3EE;
  --muted: #56667F;
  font-family: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif;
  font-feature-settings: "kern";
}
.lp-display { text-wrap: balance; }
.lp-num { font-variant-numeric: tabular-nums; }
.lp-hand { font-family: "Caveat", "Segoe Print", cursive; font-weight: 600; }

/* Graph-sheet grid, only on the answer sheet */
.lp-grid {
  --grid: #E9EFF6;
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 22px 22px;
  background-position: -1px -1px;
  background-color: #fff;
}

/* Red-pen strokes */
.lp-stroke path {
  fill: none;
  stroke: var(--red);
  stroke-width: 2.2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

/* Buttons */
.lp-btn, .lp-btn-ghost, .lp-btn-light {
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px; font-weight: 600; font-size: 15px;
  padding: 0.6rem 1.05rem; transition: background-color .15s, color .15s, border-color .15s;
}
.lp-btn { background: var(--blue); color: #fff; }
.lp-btn:hover { background: #1B3A99; }
.lp-btn-ghost { border: 1.5px solid var(--ink); color: var(--ink); }
.lp-btn-ghost:hover { background: var(--ink); color: #fff; }
.lp-btn-light { background: #fff; color: var(--ink); }
.lp-btn-light:hover { background: #E7EEF8; }
.lp-btn-lg { padding: 0.85rem 1.4rem; font-size: 16px; }

/* Focus */
.lp-focus:focus-visible { outline: 2.5px solid var(--blue); outline-offset: 3px; }
.lp-focus-dark:focus-visible { outline: 2.5px solid #fff; outline-offset: 3px; }
.lp-skip {
  position: absolute; left: 1rem; top: -3rem; z-index: 50;
  background: var(--ink); color: #fff; padding: .5rem .9rem; border-radius: 8px;
}
.lp-skip:focus { top: 1rem; }

/* One orchestrated moment: the examiner marks the sheet, then the plan appears. */
@media (prefers-reduced-motion: no-preference) {
  .lp-stroke path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: lp-draw .7s ease-out forwards; }
  .lp-num .lp-stroke path { animation-delay: .45s; }
  .lp-underline .lp-stroke path { animation-delay: 1.05s; animation-duration: .45s; }
  .lp-note { opacity: 0; animation: lp-in .5s ease-out 1.3s forwards; }
  .lp-plan { opacity: 0; transform: translateY(10px); animation: lp-in .6s ease-out 1.75s forwards; }
}
@keyframes lp-draw { to { stroke-dashoffset: 0; } }
@keyframes lp-in { to { opacity: 1; transform: none; } }
`;
