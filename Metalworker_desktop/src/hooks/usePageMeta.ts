import { useContext, useEffect } from "react";
import { PageMetaContext, type PageMeta } from "../contexts/PageMetaContext";

function usePageMetaContext() {
  const ctx = useContext(PageMetaContext);
  if (!ctx) throw new Error("PageMeta hooks must be used within a PageMetaProvider");
  return ctx;
}

export function usePageMeta(meta: PageMeta, deps: unknown[] = []): void {
  const { setMeta } = usePageMetaContext();
  const { title, subtitle, crumbs, selfTitles } = meta;

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
