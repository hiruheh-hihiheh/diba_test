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
        big ? "py-16 px-6" : "py-10 px-4"
      }`}
    >
      {icon && (
        <div
          className={`rounded-full bg-surface-hover flex items-center justify-center text-text-muted/50 mb-4 ${
            big ? "w-16 h-16" : "w-12 h-12"
          }`}
        >
          {icon}
        </div>
      )}
      <h3 className={`font-bold text-text ${big ? "text-lg" : "text-[15px]"}`}>{title}</h3>
      {description && (
        <p className="text-sm text-text-muted mt-1.5 max-w-md leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5 flex items-center gap-3 flex-wrap justify-center">{action}</div>}
    </div>
  );
}
