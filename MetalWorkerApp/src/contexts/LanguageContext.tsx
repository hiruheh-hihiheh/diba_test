import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getTranslations, type Language, type TranslationDictionary } from "../constants/translations";

const STORAGE_KEY = "mwa.language";

interface LanguageContextValue {
  language: Language;
  /** Null until the saved preference has been read from storage. */
  ready: boolean;
  t: TranslationDictionary;
  setLanguage: (next: Language) => void;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "hi";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Optimistic default so the very first frame is never blank or untranslated.
  const [language, setLanguageState] = useState<Language>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!alive) return;
        if (isLanguage(stored)) setLanguageState(stored);
      })
      .catch(() => {
        // A failed read just means we keep the default; never block the app on it.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    // Persist in the background; a failure here must not interrupt the user.
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      ready,
      t: getTranslations(language),
      setLanguage,
      toggle: () => setLanguage(language === "en" ? "hi" : "en"),
    }),
    [language, ready, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}
