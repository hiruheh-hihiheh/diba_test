// src/hooks/useSidebar.tsx

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

interface SidebarContextType {
  /** Desktop: true when the rail is narrowed to icons only. */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  /** Below the `lg` breakpoint the rail becomes an overlay drawer. */
  isMobile: boolean;
  mobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
}

export const SidebarContext = createContext<SidebarContextType | null>(null);

/** Matches Tailwind's `lg`. Kept in JS so the drawer state and the CSS agree. */
const MOBILE_QUERY = "(max-width: 1023px)";

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function useSidebar(): SidebarContextType {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
