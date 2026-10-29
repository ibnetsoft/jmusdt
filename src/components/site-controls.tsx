"use client";
import { useI18n } from "./i18n";

import { useEffect, useState } from "react";

export function SiteControls() {
  const { tr, locale, setLocale } = useI18n();
  const [theme,setTheme]=useState<"dark"|"light">("dark");
  useEffect(()=>{setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");},[]);
  function toggle() {
    const next=theme==="dark"?"light":"dark";
    document.documentElement.dataset.theme=next;
    try {localStorage.setItem("jmusdt-theme",next);} catch {}
    setTheme(next);
  }
  return <div className="site-controls" aria-label={tr("설정")}>
    {([ ["ko", "🇰🇷", "한국어"], ["en", "🇺🇸", "English"], ["ja", "🇯🇵", "日本語"] ] as const).map(([code, flag, name]) => <button key={code} type="button" aria-label={name} aria-pressed={locale === code} onClick={() => setLocale(code)}>{flag}</button>)}
    <button type="button" onClick={toggle} aria-label={theme === "dark" ? tr("브라이트 모드로 전환") : tr("다크 모드로 전환")}>{theme === "dark" ? "☀" : "☾"}</button>
  </div>;
}
