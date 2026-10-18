import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeContext, type Theme } from "./ThemeContext";

/**
 * How long the cross-fade of surfaces runs when the theme changes. Must match
 * the `theme-transition` rule in index.css.
 */
const FLIP_MS = 200;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("metalworker-theme");
      return saved === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  const flipTimer = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("metalworker-theme", theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (flipTimer.current !== null) window.clearTimeout(flipTimer.current);
    };
  }, []);

  /**
   * Mark <html> for the duration of the change so the surfaces cross-fade
   * (see the `theme-transition` rule in index.css). The class is added *before*
   * the state update so it is in place when `data-theme` changes.
   */
  const beginFlip = useCallback(() => {
    const root = document.documentElement;
    root.classList.add("theme-transition");
    if (flipTimer.current !== null) window.clearTimeout(flipTimer.current);
    flipTimer.current = window.setTimeout(() => {
      root.classList.remove("theme-transition");
      flipTimer.current = null;
    }, FLIP_MS);
  }, []);

  const setTheme = (newTheme: Theme) => {
    beginFlip();
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    beginFlip();
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
