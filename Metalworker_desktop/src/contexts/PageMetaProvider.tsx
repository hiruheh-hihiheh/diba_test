import { useMemo, useState, type ReactNode } from "react";
import { PageMetaContext, type PageMeta } from "./PageMetaContext";

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({});

  const value = useMemo(() => ({ meta, setMeta }), [meta]);

  return (
    <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>
  );
}
