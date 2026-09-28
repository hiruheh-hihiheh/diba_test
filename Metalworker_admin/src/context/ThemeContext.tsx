// src/context/ThemeContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  darkColors,
  lightColors,
  spacing,
  radius,
  textSizes,
  type AppTheme,
} from "../constants/theme";

export type ThemeMode = "light" | "dark";

interface ThemeContextType {
  themeMode: ThemeMode;
  theme: AppTheme;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "metalworker-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  // Default to the OS preference so first-launch users aren't forced to dark.
  const [themeMode, setThemeModeState] = useState<ThemeMode>(
    systemScheme === "light" ? "light" : "dark"
  );
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function loadTheme() {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === "light" || saved === "dark") {
          setThemeModeState(saved);
        }
      } catch (e) {
        console.error("Failed to load theme", e);
      } finally {
        setIsLoaded(true);
      }
    }
    loadTheme();
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    // Persist in the background; failure must not block the UI.
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch((e) => {
      console.error("Failed to save theme", e);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch((e) => {
        console.error("Failed to save theme", e);
      });
      return next;
    });
  }, []);

  const theme = useMemo<AppTheme>(
    () => ({
      colors: themeMode === "light" ? lightColors : darkColors,
      spacing,
      radius,
      textSizes,
    }),
    [themeMode]
  );

  // Render children immediately instead of returning null while AsyncStorage
  // resolves: a slow/stalled storage previously produced a blank screen.
  // `isLoaded` is kept so future callers may opt into a splash if needed.
  void isLoaded;

  return (
    <ThemeContext.Provider value={{ themeMode, theme, setThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}