// src/contexts/PageMetaContext.tsx
// Lets a page publish its own title and breadcrumb to the TopBar, so
// "Admin > Labour Jobs > test1" is accurate instead of guessing from the URL.
// Without this the TopBar showed a generic "Folder Detail" for every folder.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface Crumb {
  label: string;
  /** Omit on the last crumb — it renders as plain text, not a link. */
  to?: string;
}

interface PageMeta {
  title?: string;
  crumbs?: Crumb[];
  /** Small line under the title, e.g. "12 jobs in this folder". */
  subtitle?: string;
  /**
   * Set when the page already prints its own record count in its own header. The
   * TopBar then leaves it out, so the same figure is not printed twice on the
   * same screen.
   */
  selfTitles?: boolean;
}

interface PageMetaContextValue {
  meta: PageMeta;
  setMeta: (meta: PageMeta) => void;
}

const PageMetaContext = createContext<PageMetaContextValue | null>(null);

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({});

  const value = useMemo(() => ({ meta, setMeta }), [meta]);

  return (
    <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>
  );
}

function usePageMetaContext() {
  const ctx = useContext(PageMetaContext);
  if (!ctx) throw new Error("PageMeta hooks must be used within a PageMetaProvider");
  return ctx;
}

/**
 * Publish page title / breadcrumb / subtitle. Call at the top level of a page
 * with a plain object; the values are cleared automatically on unmount and
 * whenever the identity changes, so navigating away never leaves a stale title.
 */
export function usePageMeta(meta: PageMeta, deps: unknown[] = []): void {
  const { setMeta } = usePageMetaContext();
  const { title, subtitle, crumbs, selfTitles } = meta;

  /* The browser tab is the one place that survives switching tabs, so it carries
     the full context: "Labour Jobs — 12 of 1 240 match". */
  useEffect(() => {
    document.title = title ? (subtitle ? `${title} — ${subtitle}` : `${title} · Metalworker Admin`) : "Metalworker Admin";
  }, [title, subtitle]);

  useEffect(() => {
    setMeta({ title, subtitle, crumbs, selfTitles });
    return () => setMeta({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useCurrentPageMeta(): PageMeta {
  return usePageMetaContext().meta;
}
