import React from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { MarkedSheet } from "../components/brand/MarkedSheet";

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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink antialiased">

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
        <section data-tilt-area className="mx-auto grid max-w-[72rem] items-center gap-12 px-4 pb-20 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-28 lg:pt-24">
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

          <MarkedSheet scrollParallax />
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
