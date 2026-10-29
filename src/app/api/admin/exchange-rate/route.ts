import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
export async function GET() { return api(async () => { await identity(true); const r = await database().query("SELECT rate,version FROM exchange_rate_settings WHERE id=true"); return r.rows[0]; }); }
export async function POST(request: Request) { return api(async () => {
  checkOrigin(request); const { user } = await identity(true);
  const parsed = z.object({rate:z.number().int().min(1).max(1000000),version:z.number().int().positive()}).safeParse(await request.json());
  if (!parsed.success) throw new HttpError(400,"전환 비율을 확인해 주세요.");
  return transaction(async db => {
    const r=await db.query("UPDATE exchange_rate_settings SET rate=$1,version=version+1,updated_at=now() WHERE id=true AND version=$2 RETURNING rate,version",[parsed.data.rate,parsed.data.version]);
    if (!r.rows.length) throw new HttpError(409,"설정이 변경됐습니다. 새로고침 후 다시 저장해 주세요.");
    await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'exchange_rate.updated',$2)",[user.id,JSON.stringify({rate:r.rows[0].rate,version:r.rows[0].version})]);
    return r.rows[0];
  });
}); }
