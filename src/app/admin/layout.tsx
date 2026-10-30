import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin-sidebar";
import { identity, HttpError } from "@/lib/http";
import { isDemo } from "@/lib/supabase";
import { serverI18n } from "@/lib/i18n-server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isDemo()) {
    try { await identity(true); }
    catch (error) {
      if (error instanceof HttpError && error.status === 401) redirect("/login");
      const { tr } = await serverI18n();
      return <main className="access-denied"><h1>{tr("관리자 접근 제한")}</h1><p>{tr("관리자 권한과 서비스 설정을 확인해 주세요.")}</p><a href="/">{tr("내 지갑으로 돌아가기")}</a></main>;
    }
  }
  return <div className="admin-layout"><Suspense fallback={<aside className="admin-sidebar" />}><AdminSidebar /></Suspense><div className="admin-route-content">{children}</div></div>;
}
