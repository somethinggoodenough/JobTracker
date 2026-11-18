"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Locale, type Translate } from "@/lib/ui-language";

const storageKey = "job-radar-language";
const defaultLocale: Locale = "zh-CN";

const LanguageContext = createContext<{ locale: Locale; t: Translate; toggleLanguage: () => void }>({
  locale: defaultLocale,
  t: (message, ...values) => translate(defaultLocale, message, ...values),
  toggleLanguage: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const apply = (value: string | null) => setLocale(value === "en-US" ? "en-US" : defaultLocale);
    try {
      apply(window.localStorage.getItem(storageKey));
    } catch {
      // The switch still works for this page when storage is disabled.
    }
    function syncLanguage(event: StorageEvent) {
      if (event.storageArea === window.localStorage && (event.key === storageKey || event.key === null)) apply(event.newValue);
    }
    window.addEventListener("storage", syncLanguage);
    return () => window.removeEventListener("storage", syncLanguage);
  }, []);

  const t = useCallback<Translate>((message, ...values) => translate(locale, message, ...values), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("求职雷达 · Job Radar");
  }, [locale, t]);

  function toggleLanguage() {
    const next = locale === "zh-CN" ? "en-US" : defaultLocale;
    setLocale(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // The in-memory locale has already been updated.
    }
  }

  return <LanguageContext.Provider value={{ locale, t, toggleLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
