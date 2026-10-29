import { identity, HttpError } from "@/lib/http";
import { redirect } from "next/navigation";
import { ExchangeRateAdmin } from "@/components/exchange-rate-admin";
export const dynamic = "force-dynamic";
export default async function Page() { try { await identity(true); } catch(e) { if(e instanceof HttpError && e.status === 401) redirect("/login"); return <main className="access-denied">관리자 접근 제한</main>; } return <ExchangeRateAdmin />; }
