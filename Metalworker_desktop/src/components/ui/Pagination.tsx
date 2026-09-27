// src/components/ui/Pagination.tsx
// Client-side pagination that keeps the user's place: the page is clamped when
// the underlying result set shrinks, and the first visible row is brought back
// into view after a page change so the table header stays meaningful.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const PAGE_SIZES = [25, 50, 100, 200] as const;

export interface PaginationResult {
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  /** Slice of the full array for the current page. */
  pageItems: <T>(items: T[]) => T[];
  totalItems: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
}

export function usePagination(totalItems: number, initialPageSize = 50): PaginationResult {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Clamp when the result set shrinks (a filter, or a delete on the last page).
  useEffect(() => {
    setPageRaw((p: number) => (p > totalPages ? totalPages : p < 1 ? 1 : p));
  }, [totalPages]);

  const setPageSize = useMemo(
    () => (n: number) => {
      setPageSizeRaw(n);
      setPageRaw(1);
    },
    []
  );

  const pageItems = useMemo(
    () => <T,>(items: T[]) => {
      const start = (page - 1) * pageSize;
      return items.slice(start, start + pageSize);
    },
    [page, pageSize]
  );

  const rangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalItems);

  return {
    page,
    pageSize,
    setPage: (p) => setPageRaw(Math.min(Math.max(1, p), totalPages)),
    setPageSize,
    pageItems,
    totalItems,
    totalPages,
    rangeStart,
    rangeEnd,
  };
}

interface PaginationProps extends Omit<PaginationResult, "rangeStart" | "rangeEnd" | "pageItems"> {
  /** Noun for the summary line, e.g. "jobs" or "folders". */
  itemLabel?: string;
  scrollTargetRef?: React.RefObject<HTMLElement | null>;
  /** Hide when there is nothing to page. */
  hideWhenEmpty?: boolean;
}

export default function Pagination({
  page,
  pageSize,
  setPage,
  setPageSize,
  totalItems,
  totalPages,
  itemLabel = "records",
  scrollTargetRef,
  hideWhenEmpty = true,
}: PaginationProps) {
  const didMount = useRef(false);

  useEffect(() => {
    // Skip the initial render so paging never fights the page load scroll reset.
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    scrollTargetRef?.current?.scrollIntoView({ block: "nearest" });
  }, [page, scrollTargetRef]);

  if (hideWhenEmpty && totalItems === 0) return null;

  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  /* Controls are only shown when they can do something.

     Previously a list of 2 workers still rendered "Rows [25|50|100|200|1000]"
     and four pager arrows, all of them inert or meaningless: there was one page,
     and no page size could change what was visible. Same for a page-size list
     offering 1000 rows to someone who has 268. Offering choices that cannot
     change the result is worse than offering none, because it invites the user
     to hunt for a setting that was never going to work. */
  const showPager = totalPages > 1;
  const showPageSize = totalItems > PAGE_SIZES[0];
  const pageSizeOptions = PAGE_SIZES.filter((s) => s < totalItems || s === pageSize);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border shrink-0"
    >
      <div className="flex items-center gap-3 text-xs text-text-muted">
        {showPager ? (
          <span>
            {from === 0 ? "0" : <span className="font-semibold text-text">{from}</span>}
            {"–"}
            <span className="font-semibold text-text">{to}</span> of{" "}
            <span className="font-semibold text-text">{totalItems.toLocaleString()}</span>{" "}
            {itemLabel}
          </span>
        ) : (
          /* One page: "1–2 of 2" is noise that reads like a truncation. */
          <span>
            <span className="font-semibold text-text">{totalItems.toLocaleString()}</span>{" "}
            {itemLabel}
          </span>
        )}
        {showPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Rows per page"
              className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {showPager && (
        <div className="flex items-center gap-1">
          <PagerButton
            onClick={() => setPage(1)}
            disabled={page === 1}
            label="First page"
          >
            <ChevronsLeft size={15} />
          </PagerButton>
          <PagerButton
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            label="Previous page"
          >
            <ChevronLeft size={15} />
          </PagerButton>

          <span className="px-3 text-xs font-semibold text-text tabular-nums">
            Page {page} of {totalPages}
          </span>

          <PagerButton
            onClick={() => setPage(page + 1)}
            disabled={page === totalPages}
            label="Next page"
          >
            <ChevronRight size={15} />
          </PagerButton>
          <PagerButton
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
            label="Last page"
          >
            <ChevronsRight size={15} />
          </PagerButton>
        </div>
      )}
    </nav>
  );
}

function PagerButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {children}
    </button>
  );
}
