import { serverI18n } from "@/lib/i18n-server";
import { Rewards } from "@/components/rewards";
import { identity, HttpError } from "@/lib/http";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { tr } = await serverI18n();
  try {
    await identity(true);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/login");
    return (
      <main className="access-denied">
        <h1>{tr("관리자 권한이 필요합니다.")}</h1>
        <a href="/">{tr("내 지갑")}</a>
      </main>
    );
  }
  return <Rewards admin />;
}
