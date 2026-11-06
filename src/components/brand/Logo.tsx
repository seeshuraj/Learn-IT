import React from "react";

/** The LearnIT mark and wordmark, used on the landing page, sign-in and app sidebar. */
export const Logo: React.FC<{ className?: string; inverted?: boolean }> = ({ className = "", inverted = false }) => (
  <span className={`flex items-center gap-2.5 ${className}`}>
    <img
      src="/favicon.svg"
      alt=""
      width={32}
      height={32}
      className={`h-8 w-8 rounded-md ${inverted ? "ring-1 ring-white/15" : ""}`}
    />
    <span className={`text-[17px] font-bold tracking-tight ${inverted ? "text-white" : "text-ink"}`}>LearnIT</span>
  </span>
);
