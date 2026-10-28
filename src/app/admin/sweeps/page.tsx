import { Sweeps } from "@/components/sweeps";
import { identity, HttpError } from "@/lib/http";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await identity(true);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/login");
    return (
      <main className="access-denied">
        <h1>관리자 권한이 필요합니다.</h1>
      </main>
    );
  }
  return <Sweeps />;
}
