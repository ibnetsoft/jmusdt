import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
import { encryptTronKey, clearTronKeyCache } from "@/lib/tron-api-settings";

export async function GET() {
  return api(async () => {
    await identity(true);
    const result = await database().query("SELECT updated_at FROM tron_api_settings WHERE id=true");
    return { configured: !!result.rows.length || !!process.env.TRONGRID_API_KEY, updatedAt: result.rows[0]?.updated_at ?? null, writable: (process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY || process.env.CRON_SECRET || "").length >= 32 };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true, true);
    const parsed = z.object({ key: z.string().trim().min(10).max(200).regex(/^[A-Za-z0-9_-]+$/) }).safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "TronGrid API 키를 확인해 주세요.");
    let response: Response;
    try {
      response = await fetch("https://api.trongrid.io/wallet/getnowblock", { method: "POST", headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": parsed.data.key }, body: "{}", cache: "no-store", signal: AbortSignal.timeout(10000) });
    } catch { throw new HttpError(503, "TronGrid에 연결하지 못했습니다. 잠시 후 다시 시도하세요."); }
    if (!response.ok) throw new HttpError(400, "API 키 또는 TronGrid 서비스 상태를 확인해 주세요.");
    const block = await response.json();
    if (!Number.isSafeInteger(block?.block_header?.raw_data?.number)) throw new HttpError(503, "TronGrid 응답을 확인하지 못했습니다.");
    const encrypted = encryptTronKey(parsed.data.key);
    await transaction(async db => {
      await db.query("INSERT INTO tron_api_settings(id,encrypted_key,updated_by) VALUES(true,$1,$2) ON CONFLICT(id) DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,updated_by=EXCLUDED.updated_by,updated_at=now()", [encrypted, user.id]);
      await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'tron.api_key_updated','{}'::jsonb)", [user.id]);
    });
    clearTronKeyCache();
    return { ok: true };
  });
}
