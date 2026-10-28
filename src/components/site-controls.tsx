"use client";
import { useEffect, useState } from "react";

export function SiteControls() {
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
    {logo && <a href="/" aria-label="JMUSDT 홈" style={{display:logoReady?"block":"none"}}><img src="/api/branding/logo" alt="JMUSDT 로고" onLoad={()=>setLogoReady(true)} onError={()=>setLogo(false)} /></a>}
    <button type="button" onClick={toggle} aria-label={theme==="dark"?"브라이트 모드로 전환":"다크 모드로 전환"}>{theme==="dark"?"☀ 브라이트":"☾ 다크"}</button>
  </div>;
}
