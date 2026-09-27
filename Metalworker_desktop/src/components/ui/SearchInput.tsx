// src/components/ui/SearchInput.tsx
// One search control for the whole app: obvious scope, live result count,
// a clear button, and a highlighted "filter active" state.

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** What the user is searching — shown as the hint and in the count line. */
  scope: string;
  /**
   * Singular noun for the thing being searched, e.g. "folder", "job", "user".
   * The count line is "3 folders", not "3 records" — a folder search that
   * reports "3 records" is actively misleading. Defaults to the last word of
   * `scope`, which is right for every current call site; pass it explicitly
   * where that would be wrong.
   */
  unit?: string;
  /** Number of matches after filtering. */
  resultCount: number;
  /** Total before filtering. Omit to hide the "of N" suffix. */
  totalCount?: number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  /** Rendered under the field, e.g. an active-filter chip row. */
  children?: React.ReactNode;
}

export default function SearchInput({
  value,
  onChange,
  scope,
  unit,
  resultCount,
  totalCount,
  placeholder,
  className = "",
  inputClassName = "",
  autoFocus = false,
  children,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = value.trim().length > 0;
  const isFiltering = hasQuery || (totalCount !== undefined && resultCount !== totalCount);

  /* "available labour jobs" → "job"; "folders" → "folder". */
  const noun =
    unit ?? scope.trim().split(/[\s/]+/).filter(Boolean).pop()?.replace(/s$/, "") ?? "result";
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`);

  // "/" focuses search, the way every data-heavy admin tool behaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={className}>
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
        />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label={`Search ${scope}`}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Search ${scope}…  (press / to focus)`}
          className={`w-full pl-10 pr-10 py-2.5 rounded-xl bg-surface border text-sm text-text
            placeholder:text-text-muted/50 transition-all
            focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
            [&::-webkit-search-cancel-button]:hidden
            ${isFiltering ? "border-primary/60" : "border-border"}
            ${inputClassName}`}
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            title="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Result count / active-filter line */}
      <div className="flex items-center justify-between gap-3 mt-1.5 min-h-[18px]">
        <p className="text-xs text-text-muted">
          {hasQuery ? (
            <>
              <span className="font-semibold text-text">{resultCount}</span>{" "}
              {resultCount === 1 ? "match" : "matches"} for{" "}
              <span className="font-semibold text-text">“{value.trim()}”</span>
              {totalCount !== undefined && ` of ${totalCount}`}
            </>
          ) : totalCount !== undefined ? (
            <>
              {resultCount} {plural(resultCount)}
            </>
          ) : null}
        </p>
        {hasQuery && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs font-semibold text-primary hover:underline cursor-pointer shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      {children}
    </div>
  );
}
