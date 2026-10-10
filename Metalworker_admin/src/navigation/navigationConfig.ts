// src/navigation/navigationConfig.ts
//
// Single source of truth for the admin chrome that wraps the expo-router
// screens: the bottom navigation, the Jobs / More sheets, the hamburger
// drawer, and which routes get a back button instead of the hamburger.
//
// No business logic lives here — it only describes navigation and maps a
// pathname to the chrome that should be shown for it.
import { router, type Href } from "expo-router";

export type NavItemAction = "route" | "theme" | "signout";

export interface NavItem {
  /** Stable key used as React key and for active-state checks. */
  key: string;
  label: string;
  icon: string;
  /** Route to push when the item is a plain route item. */
  route?: string;
  /** `route` or a special action (theme toggle / sign out). */
  action?: NavItemAction;
}

export interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
}

export type BottomTabKey = "home" | "jobs" | "bills" | "folders" | "more";

export interface BottomTab {
  key: BottomTabKey;
  label: string;
  icon: string;
  /** Route this tab navigates to directly (when not opening a sheet). */
  route?: string;
  /** Which sheet this tab opens (sheet tabs have no route). */
  sheet?: "jobs" | "more";
  /** Paths that should keep this tab visually selected. */
  activeRoutes: string[];
}

/**
 * Bottom bar — high-frequency destinations only. Jobs and More open sheets
 * instead of navigating, so they never carry an active state themselves.
 */
export const BOTTOM_TABS: BottomTab[] = [
  {
    key: "home",
    label: "Home",
    icon: "🏠",
    route: "/dashboard",
    activeRoutes: ["/dashboard"],
  },
  {
    key: "jobs",
    label: "Jobs",
    icon: "💼",
    sheet: "jobs",
    activeRoutes: ["/jobs-labour", "/jobs-with-material"],
  },
  {
    key: "bills",
    label: "Bills",
    icon: "🧾",
    route: "/bills",
    activeRoutes: ["/bills", "/bill-create"],
  },
  {
    key: "folders",
    label: "Folders",
    icon: "📁",
    route: "/folders",
    activeRoutes: ["/folders", "/folder-detail"],
  },
  {
    key: "more",
    label: "More",
    icon: "⋯",
    sheet: "more",
    activeRoutes: [],
  },
];

/** Two real job routes; the Jobs tab opens this sheet. */
export const JOBS_SHEET_SECTIONS: NavSection[] = [
  {
    key: "jobs",
    title: "Jobs",
    items: [
      { key: "jobs-labour", label: "Labour Jobs", icon: "🧰", route: "/jobs-labour" },
      { key: "jobs-with-material", label: "With Material Jobs", icon: "🔩", route: "/jobs-with-material" },
    ],
  },
];

/** Less-used areas the "More" tab opens; grouped for scannability. */
export const MORE_SHEET_SECTIONS: NavSection[] = [
  {
    key: "operations",
    title: "Operations",
    items: [{ key: "dispatch", label: "Dispatches", icon: "🚚", route: "/dispatch" }],
  },
  {
    key: "inventory",
    title: "Inventory",
    items: [
      { key: "stock-owner", label: "Stock by Owner", icon: "📦", route: "/stock-owner" },
      { key: "stock-company", label: "Stock by Company", icon: "🏢", route: "/stock-company" },
    ],
  },
  {
    key: "documents",
    title: "Documents",
    items: [
      { key: "group-bills", label: "Group Bills", icon: "🧾", route: "/group-bills" },
      { key: "group-drawings", label: "Group Drawings", icon: "✏️", route: "/group-drawings" },
      { key: "invoice-settings", label: "Invoice Profile", icon: "🏷️", route: "/invoice-settings" },
      { key: "invoice-logos", label: "Invoice Logos", icon: "🖼️", route: "/invoice-logos" },
    ],
  },
  {
    key: "settings",
    title: "Settings",
    items: [
      { key: "theme", label: "Switch Theme", icon: "🌓", action: "theme" },
      { key: "signout", label: "Sign Out", icon: "🚪", action: "signout" },
    ],
  },
];

/** The full hamburger drawer — everything in one place. */
export const DRAWER_SECTIONS: NavSection[] = [
  {
    key: "top",
    title: "",
    items: [{ key: "dashboard", label: "Dashboard", icon: "🏠", route: "/dashboard" }],
  },
  {
    key: "operations",
    title: "Operations",
    items: [{ key: "dispatch", label: "Dispatches", icon: "🚚", route: "/dispatch" }],
  },
  {
    key: "jobs",
    title: "Jobs",
    items: [
      { key: "jobs-labour", label: "Labour Jobs", icon: "🧰", route: "/jobs-labour" },
      { key: "jobs-with-material", label: "With Material Jobs", icon: "🔩", route: "/jobs-with-material" },
    ],
  },
  {
    key: "inventory",
    title: "Inventory",
    items: [
      { key: "stock-owner", label: "Stock by Owner", icon: "📦", route: "/stock-owner" },
      { key: "stock-company", label: "Stock by Company", icon: "🏢", route: "/stock-company" },
    ],
  },
  {
    key: "documents",
    title: "Documents",
    items: [
      { key: "bills", label: "Bills", icon: "🧾", route: "/bills" },
      { key: "bill-create", label: "Create Bill", icon: "➕", route: "/bill-create" },
      { key: "group-bills", label: "Group Bills", icon: "🧾", route: "/group-bills" },
      { key: "group-drawings", label: "Group Drawings", icon: "✏️", route: "/group-drawings" },
      { key: "invoice-settings", label: "Invoice Profile", icon: "🏷️", route: "/invoice-settings" },
      { key: "invoice-logos", label: "Invoice Logos", icon: "🖼️", route: "/invoice-logos" },
    ],
  },
  {
    key: "organization",
    title: "Organization",
    items: [{ key: "folders", label: "Folders", icon: "📁", route: "/folders" }],
  },
  {
    key: "settings",
    title: "Settings",
    items: [
      { key: "theme", label: "Switch Theme", icon: "🌓", action: "theme" },
      { key: "signout", label: "Sign Out", icon: "🚪", action: "signout" },
    ],
  },
];

/** Header title shown for each route (the shell owns the header). */
export const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dispatch": "Dispatches",
  "/dispatch-details": "Dispatch Details",
  "/jobs-labour": "Labour Jobs",
  "/jobs-with-material": "With Material Jobs",
  "/bills": "Bills",
  "/bill-create": "Create Bill",
  "/folders": "Folders",
  "/folder-detail": "Folder Details",
  "/stock-owner": "Stock by Owner",
  "/stock-company": "Stock by Company",
  "/group-bills": "Group Bills",
  "/group-drawings": "Group Drawings",
  "/invoice-settings": "Invoice Profile",
  "/invoice-logos": "Invoice Logos",
  "/login": "Login",
  "/": "MetalWorker Admin",
};

/**
 * Routes that render a single focus screen: the shell header uses a back
 * button instead of the hamburger. Parent routes are fallbacks for when the
 * screen was entered directly (no history to go back to).
 */
export const DETAIL_ROUTE_PARENTS: Record<string, string> = {
  "/dispatch-details": "/dispatch",
  "/folder-detail": "/folders",
  "/bill-create": "/bills",
};

export const DETAIL_ROUTES = new Set(Object.keys(DETAIL_ROUTE_PARENTS));

export function titleForRoute(pathname: string): string {
  return ROUTE_TITLES[pathname] ?? "MetalWorker Admin";
}

export function isDetailRoute(pathname: string): boolean {
  return DETAIL_ROUTES.has(pathname);
}

export function parentRouteFor(pathname: string): string | undefined {
  return DETAIL_ROUTE_PARENTS[pathname];
}

/**
 * Which bottom tab should be highlighted for a given pathname, or null when
 * no tab owns the route (e.g. `/dispatch` — reached from the More sheet).
 */
export function activeTabForPath(pathname: string): BottomTabKey | null {
  for (const tab of BOTTOM_TABS) {
    if (tab.activeRoutes.includes(pathname)) {
      return tab.key;
    }
  }
  return null;
}

/**
 * Central navigation entry point for the shell. Routes live as plain strings
 * here; the typed-routes union is incomplete (`/bill-create`, `/invoice-settings`
 * are missing from the generated types even though the routes exist), so we
 * run `npx expo customize tsconfig.json`-style casts by going through `Href`.
 */
export function navigateTo(route: string) {
  router.push(route as Href);
}