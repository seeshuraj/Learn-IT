import React from "react";
import { Link } from "react-router-dom";
import { Logo } from "./Logo";

interface AuthShellProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}

/** Single-column layout shared by the password pages (forgot, reset, first-login change). */
export const AuthShell: React.FC<AuthShellProps> = ({ title, subtitle, children }) => (
  <div className="flex min-h-screen flex-col bg-paper px-4 py-6 text-ink sm:px-10">
    <header>
      <Link to="/landing" className="lp-focus inline-block rounded-md" aria-label="LearnIT home">
        <Logo />
      </Link>
    </header>

    <main className="flex flex-1 items-center py-12">
      <div className="mx-auto w-full max-w-[24rem]">
        <h1 className="lp-display text-[clamp(1.9rem,5vw,2.3rem)] font-extrabold leading-[1.08] tracking-[-0.03em]">
          {title}
        </h1>
        {subtitle && <p className="mt-3 text-[16px] leading-[1.55] text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </main>

    <footer className="text-[13px] text-muted">© {new Date().getFullYear()} LearnIT Analytics Pvt Ltd</footer>
  </div>
);

export const FormError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="alert" className="rounded-[10px] border border-pen/25 bg-[#FBEDEF] px-4 py-3 text-[14px] leading-[1.5] text-pen">
    {children}
  </p>
);
