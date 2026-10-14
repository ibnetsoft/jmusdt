import { AdminApp } from "@/components/admin";
import { identity, HttpError } from "@/lib/http";
import { isDemo } from "@/lib/supabase";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!isDemo()) {
    try {
      await identity(true);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) redirect("/login");
      return (
        <main className="access-denied">
          <h1>관리자 접근 제한</h1>
          <p>관리자 권한과 서비스 설정을 확인해 주세요.</p>
          <a href="/">내 지갑으로 돌아가기</a>
        </main>
      );
    }
  }
  return <AdminApp />;
}
