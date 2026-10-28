"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { localeCookie, localeTags, supportedLocale, translator, type Locale } from "@/lib/i18n";

type LanguageContext = {
  locale: Locale;
  localeTag: string;
  tr: ReturnType<typeof translator>;
  setLocale: (locale: Locale) => void;
};
const Context = createContext<LanguageContext | null>(null);
export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const router = useRouter();
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo<LanguageContext>(() => ({
    locale, localeTag: localeTags[locale], tr: translator(locale),
    setLocale: next => {
      const selected = supportedLocale(next);
      document.cookie = `${localeCookie}=${selected}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      document.documentElement.lang = selected;
      updateLocale(selected);
      router.refresh();
    },
  }), [locale, router]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  const context = useContext(Context);
  if (!context) throw new Error("LanguageProvider is required");
  return context;
}
