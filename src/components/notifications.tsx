"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell } from "lucide-react";
import { useI18n } from "./i18n";
import { BottomNav } from "./bottom-nav";

type Notice = { id: string; title: string; body: string; created_at: string };
export function Notifications() {
  const { tr, locale, localeTag } = useI18n();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setNotices(null);
    fetch(`/api/notifications?lang=${locale}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || tr("알림을 불러오지 못했습니다.")); setNotices(data.notifications); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tr("알림을 불러오지 못했습니다.")); });
    return () => controller.abort();
  }, [locale, tr]);
  return <><main className="notifications-page">
    <header className="notifications-header"><button type="button" aria-label={tr("뒤로 가기")} onClick={() => {
      let previous = "";
      try { previous = sessionStorage.getItem("wu-notifications-return") || ""; sessionStorage.removeItem("wu-notifications-return"); } catch {}
      if (previous.startsWith("/") && !previous.startsWith("//") && previous !== "/notifications" && history.length > 1) {
        try { if (previous === "/") sessionStorage.setItem("wu-returning-from-notifications", "1"); } catch {}
        router.back();
      } else router.push("/");
    }}><ArrowLeft size={22} aria-hidden="true" /></button><h1>{tr("알림")}</h1></header>
    {error && <p className="notifications-error" role="alert">{error}</p>}
    {notices?.length === 0 && <div className="notifications-empty"><Bell size={28} aria-hidden="true" /><p>{tr("새로운 알림이 없습니다.")}</p></div>}
    {notices?.map(notice => <article className="notification-item" key={notice.id}><h2>{notice.title}</h2><time dateTime={notice.created_at}>{new Date(notice.created_at).toLocaleString(localeTag, {timeZone:"Asia/Seoul",year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</time><p>{notice.body}</p></article>)}
  </main><BottomNav /></>;
}
