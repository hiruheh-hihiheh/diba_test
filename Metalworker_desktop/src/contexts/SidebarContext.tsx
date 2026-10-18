import { useCallback, useState, type ReactNode } from "react";
import { SidebarContext } from "../hooks/useSidebar";
import { useIsMobile } from "../hooks/useSidebar";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Never leave the drawer open when the viewport grows past the breakpoint.
  if (!isMobile && mobileOpen) {
    setMobileOpen(false);
  }

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        setCollapsed,
        toggle: () => setCollapsed((prev) => !prev),
        isMobile,
        mobileOpen,
        openMobile,
        closeMobile,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
