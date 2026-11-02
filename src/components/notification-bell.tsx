"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useI18n } from "./i18n";

export function NotificationBell() {
  const pathname = usePathname();
  const { tr } = useI18n();
  if (!pathname || ["/admin", "/login", "/auth", "/reset-password", "/notifications"].some(path => pathname === path || pathname.startsWith(path + "/"))) return null;
  return <Link className="notification-bell" href="/notifications" onClick={() => { try { sessionStorage.setItem("wu-notifications-return", location.pathname + location.search); } catch {} }} aria-label={tr("알림")} title={tr("알림")}><Bell size={22} aria-hidden="true" /></Link>;
}
