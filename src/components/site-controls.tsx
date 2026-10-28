"use client";
import { useI18n } from "./i18n";

import { useEffect, useState } from "react";

export function SiteControls() {
  const { tr, locale, setLocale } = useI18n();
  const [theme,setTheme]=useState<"dark"|"light">("dark");
  const [logo,setLogo]=useState(true);
  const [logoReady,setLogoReady]=useState(false);
  useEffect(()=>{setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");},[]);
  function toggle() {
    const next=theme==="dark"?"light":"dark";
    document.documentElement.dataset.theme=next;
    try {localStorage.setItem("jmusdt-theme",next);} catch {}
    setTheme(next);
  }
  return <div className="site-controls">
    {logo && <a href="/" aria-label={tr("JMUSDT 홈")} style={{display:logoReady?"block":"none"}}><img src="/api/branding/logo" alt={tr("JMUSDT 로고")} onLoad={()=>setLogoReady(true)} onError={()=>setLogo(false)} /></a>}
    <select aria-label={tr("언어 선택")} value={locale} onChange={e=>setLocale(e.target.value as "ko"|"en"|"ja")}>
      <option value="ko" lang="ko">한국어</option>
      <option value="en" lang="en">English</option>
      <option value="ja" lang="ja">日本語</option>
    </select>
    <button type="button" onClick={toggle} aria-label={theme==="dark"?tr("브라이트 모드로 전환"):tr("다크 모드로 전환")}>{theme==="dark"?tr("☀ 브라이트"):tr("☾ 다크")}</button>
  </div>;
}
