import { useMemo, useState } from "react";

export interface PaginationResult {
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  pageItems: <T>(items: T[]) => T[];
  totalItems: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
}

export function usePagination(totalItems: number, initialPageSize = 50): PaginationResult {
  const [pageRaw, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, pageRaw), totalPages);

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
    setPage: (p) => setPageRaw(p),
    setPageSize,
    pageItems,
    totalItems,
    totalPages,
    rangeStart,
    rangeEnd,
  };
}
