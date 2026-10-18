// src/components/ui/EmptyState.tsx
// Consistent explanation + next action for every "nothing here" screen.

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Primary next step, e.g. "Clear search" or "New folder". */
  action?: ReactNode;
  size?: "sm" | "md";
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
}: EmptyStateProps) {
  const big = size === "md";
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        big ? "py-14 px-6" : "py-9 px-4"
      }`}
    >
      {icon && (
        <div
          className={`relative rounded-xl border border-border bg-bg-secondary flex items-center justify-center text-text-muted mb-4 ${
            big ? "w-12 h-12" : "w-10 h-10"
          }`}
        >
          <span aria-hidden="true" className="absolute inset-0 rounded-xl bg-primary/[0.06]" />
          {icon}
        </div>
      )}
      <h3
        className={`font-semibold text-text tracking-[-0.005em] ${
          big ? "text-[15px]" : "text-[13.5px]"
        }`}
      >
        {title}
      </h3>
      {description && (
        <p
          className={`text-text-muted mt-1.5 max-w-[34rem] leading-relaxed ${
            big ? "text-[13px]" : "text-[12px]"
          }`}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex items-center gap-2 flex-wrap justify-center">{action}</div>}
    </div>
  );
}
