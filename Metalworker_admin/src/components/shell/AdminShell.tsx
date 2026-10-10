// src/components/shell/AdminShell.tsx
//
// The shared chrome shell for every admin route that is not the login /
// splash screens: a header (hamburger + title + theme toggle), the routed
// content in the middle, the fixed bottom bar, an "everything" drawer and the
// Jobs / More bottom sheets.
//
// Layout is normal flex flow (Header / content / BottomNav), so content is
// never hidden behind the bottom bar. The drawer is an in-tree absolute
// overlay over the whole shell; the sheets are RN Modals. No routing or
// Supabase logic lives here beyond what chrome needs.
import React, { useCallback, useEffect, useState } from "react";
import { BackHandler, Platform, StyleSheet, View } from "react-native";
import { router, usePathname } from "expo-router";

import { useTheme } from "../../context/ThemeContext";
import { supabase } from "../../services/supabase";
import { notify } from "../../utils/notify";
import {
  activeTabForPath,
  DRAWER_SECTIONS,
  isDetailRoute,
  JOBS_SHEET_SECTIONS,
  MORE_SHEET_SECTIONS,
  navigateTo,
  parentRouteFor,
  titleForRoute,
  type BottomTabKey,
  type NavItem,
} from "../../navigation/navigationConfig";

import { AdminHeader } from "./AdminHeader";
import { BottomNavigation } from "./BottomNavigation";
import { NavigationDrawer } from "./NavigationDrawer";
import { NavSheet } from "./NavSheet";

interface AdminShellProps {
  children: React.ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  const title = titleForRoute(pathname);
  const showBack = isDetailRoute(pathname);
  const activeTab: BottomTabKey | null = activeTabForPath(pathname);
  const openSheet: "jobs" | "more" | null = jobsOpen ? "jobs" : moreOpen ? "more" : null;

  // Android back priority: drawer → Jobs sheet → More sheet → default (the
  // router handles back on detail screens and the rest of the stack).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (jobsOpen) {
        setJobsOpen(false);
        return true;
      }
      if (moreOpen) {
        setMoreOpen(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [drawerOpen, jobsOpen, moreOpen]);

  // Web: Escape closes the drawer and any open sheet.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setJobsOpen(false);
        setMoreOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Resolve the signed-in email once for the drawer footer.
  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) setSignedInAs(data.session?.user.email ?? null);
      })
      .catch(() => {
        if (alive) setSignedInAs(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        notify("Logout Failed", error.message);
        return;
      }
      router.dismissAll();
      router.replace("/login");
    } catch (error) {
      notify(
        "Logout Failed",
        error instanceof Error ? error.message : "Unable to logout. Please try again."
      );
    }
  }, []);

  /** Central press handler for drawer + sheet items. */
  const handleItemPress = useCallback(
    (item: NavItem) => {
      setDrawerOpen(false);
      setJobsOpen(false);
      setMoreOpen(false);
      if (item.action === "theme") {
        toggleTheme();
      } else if (item.action === "signout") {
        void handleSignOut();
      } else if (item.route) {
        navigateTo(item.route);
      }
    },
    [handleSignOut, toggleTheme]
  );

  const handleBackPress = useCallback(() => {
    const parent = parentRouteFor(pathname);
    if (router.canGoBack()) {
      router.back();
    } else if (parent) {
      navigateTo(parent);
    }
  }, [pathname]);

  const handleBottomSelect = useCallback((key: BottomTabKey) => {
    switch (key) {
      case "home":
        navigateTo("/dashboard");
        break;
      case "bills":
        navigateTo("/bills");
        break;
      case "folders":
        navigateTo("/folders");
        break;
      case "jobs":
        setJobsOpen(true);
        break;
      case "more":
        setMoreOpen(true);
        break;
    }
  }, []);

  return (
    <View style={[styles.shell, { backgroundColor: theme.colors.background }]}>
      <AdminHeader
        title={title}
        showBack={showBack}
        onMenuPress={() => setDrawerOpen(true)}
        onBackPress={handleBackPress}
      />

      <View style={styles.content}>{children}</View>

      <BottomNavigation
        activeTab={activeTab}
        openSheet={openSheet}
        onSelect={handleBottomSelect}
      />

      <NavigationDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onItemPress={handleItemPress}
        sections={DRAWER_SECTIONS}
        currentPath={pathname}
        signedInAs={signedInAs}
      />

      <NavSheet
        visible={jobsOpen}
        title="Jobs"
        sections={JOBS_SHEET_SECTIONS}
        onClose={() => setJobsOpen(false)}
        onItemPress={handleItemPress}
      />

      <NavSheet
        visible={moreOpen}
        title="More"
        sections={MORE_SHEET_SECTIONS}
        onClose={() => setMoreOpen(false)}
        onItemPress={handleItemPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});