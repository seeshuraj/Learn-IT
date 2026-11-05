import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { normalizeMath } from "../shared/formatAnswer";

/**
 * Renders AI-generated text as basic Markdown.
 *
 * Model output is untrusted (it can echo course names, notes or prompt
 * injection), so this never uses dangerouslySetInnerHTML: react-markdown
 * escapes raw HTML, images are dropped (no external requests from AI text),
 * and links open in a new tab without a referrer.
 */
const components: Components = {
  p:      ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul:     ({ children }) => <ul className="my-1.5 list-disc pl-5 space-y-0.5">{children}</ul>,
  ol:     ({ children }) => <ol className="my-1.5 list-decimal pl-5 space-y-0.5">{children}</ol>,
  li:     ({ children }) => <li className="pl-0.5">{children}</li>,
  h1:     ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h2:     ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h3:     ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h4:     ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-slate-300 pl-3 text-slate-600">{children}</blockquote>,
  code:   ({ children }) => <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[0.85em] font-mono">{children}</code>,
  pre:    ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-slate-800 p-3 text-xs text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>,
  a:      ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
      {children}
    </a>
  ),
  hr:     () => <hr className="my-2 border-slate-300" />,
};

export const MarkdownMessage: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <div className={`break-words ${className ?? ""}`}>
    <ReactMarkdown components={components} disallowedElements={["img"]} unwrapDisallowed skipHtml>
      {normalizeMath(text)}
    </ReactMarkdown>
  </div>
);
