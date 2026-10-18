import { createContext } from "react";

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageMeta {
  title?: string;
  crumbs?: Crumb[];
  subtitle?: string;
  selfTitles?: boolean;
}

export interface PageMetaContextValue {
  meta: PageMeta;
  setMeta: (meta: PageMeta) => void;
}

export const PageMetaContext = createContext<PageMetaContextValue | null>(null);
