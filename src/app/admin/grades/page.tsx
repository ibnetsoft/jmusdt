import { identity, HttpError } from "@/lib/http";
import { redirect } from "next/navigation";
import { MemberGrades } from "@/components/member-grades";
export const dynamic = "force-dynamic";
export default async function Page() {
  try { await identity(true); }
  catch (e) { if (e instanceof HttpError && e.status===401) redirect("/login"); return <main>관리자 권한이 필요합니다.</main>; }
  return <MemberGrades />;
}
