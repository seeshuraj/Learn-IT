import React, { useRef } from "react";
import { useTiltParallax } from "./useTiltParallax";

/**
 * The marked unit test: LearnIT's signature visual. An examiner's red-pen
 * annotation explains *why* marks were lost; the study plan LearnIT builds
 * from it floats above the sheet.
 *
 * Built as 3D layers (sheet, red-pen note, plan) for useTiltParallax. The
 * CSS entry animation runs on inner elements and GSAP moves the wrapper
 * layers, so the two never fight over `transform`.
 */

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

interface MarkedSheetProps {
  /** Tilt toward the pointer (desktop only). */
  tilt?: boolean;
  /** Layers drift apart while scrolling past (landing hero). */
  scrollParallax?: boolean;
  /** Smaller type and spacing, e.g. beside the sign-in form. */
  compact?: boolean;
  className?: string;
}

export const MarkedSheet: React.FC<MarkedSheetProps> = ({ tilt = true, scrollParallax = false, compact = false, className = "" }) => {
  const scope = useRef<HTMLDivElement>(null);
  useTiltParallax(scope, { enabled: tilt, scroll: scrollParallax });
  const total = MARKS.reduce((n, m) => n + m.got, 0);
  const pad = compact ? "p-5 sm:p-6" : "p-5 sm:p-7";

  return (
    <div ref={scope} className={`relative w-full text-ink ${className}`}>
      <figure
        data-tilt-stage
        className="lp-stage relative w-full"
        aria-label="Example: a marked unit test and the study plan LearnIT creates from it"
      >
        {/* Layer 0: the answer sheet */}
        <div data-depth="0" className="lp-layer">
          <div className={`lp-grid lp-layer rounded-[14px] border border-rule ${pad} shadow-[0_1px_0_var(--rule),0_24px_48px_-28px_rgba(19,32,59,0.35)]`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-ink pb-3">
              <p className="text-[15px] font-semibold">Unit Test 2, Data Structures</p>
              <p className="text-[13px] text-muted">Priya R., II year CSE</p>
            </div>

            <div className="lp-layer grid gap-x-6 sm:grid-cols-[1fr_auto]">
              <table className="mt-1 w-full border-collapse text-[14px]">
                <caption className="sr-only">Marks by question</caption>
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">Question</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Topic</th>
                    <th scope="col" className="py-2 text-right font-medium">Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {MARKS.map(m => (
                    <tr key={m.q} className="border-t border-rule">
                      <td className="py-2.5 pr-3 text-muted">{m.q}</td>
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
                  <tr className="border-t-2 border-ink font-semibold">
                    <td className="py-2.5" colSpan={2}>Total</td>
                    <td className="lp-num py-2.5 text-right">{total}/50</td>
                  </tr>
                </tbody>
              </table>

              {/* Layer 1: examiner's margin note, lifted slightly off the paper */}
              <p className="lp-note lp-layer mt-3 max-w-[15rem] sm:mt-[6.5rem] sm:w-[10.5rem]">
                <span data-depth="1" className="lp-hand block text-[22px] leading-[1.1] text-pen">
                  Mixed up traversal order in all three parts. Revise Module 3.
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Layer 2: what LearnIT does with it, floating highest */}
        <div data-depth="2.2" className={`relative -mt-3 ml-auto w-[92%] ${compact ? "sm:-mt-5 sm:w-[86%]" : "sm:-mt-6 sm:w-[82%]"}`}>
          <div className="lp-plan rounded-[14px] border border-rule bg-paper p-5 shadow-[0_18px_40px_-24px_rgba(19,32,59,0.45)]">
            <p className="text-[14px] font-semibold">This week's plan for Priya</p>
            <p className="mt-0.5 text-[13px] text-muted">Built from Unit Test 2 and her course notes</p>
            <ul className="mt-3 space-y-2 text-[14px]">
              {PLAN.map(item => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-[5px] h-3 w-3 shrink-0 rounded-[3px] border-[1.5px] border-brand" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </figure>
    </div>
  );
};
