import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { transaction } from "@/lib/db";
import { companyWalletAddress } from "@/lib/company-wallet-address";
import {
  sweepDashboard,
  previewSweeps,
  approveSweeps,
  cancelSweep,
  sweepRuntime,
} from "@/lib/sweeps";
import { SweepError } from "@/lib/sweep-chain";
import { canManageFunds } from "@/lib/admin-access";
export const maxDuration = 300;
async function sweepApi(fn: () => Promise<unknown>) {
  return api(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SweepError) throw new HttpError(409, e.message);
      if (e instanceof Error && e.message.includes("SWEEP_"))
        throw new HttpError(
          409,
          "검토 만료·설정 변경 또는 이미 진행 중인 지갑입니다. 새로고침 후 다시 검토하세요.",
        );
      throw e;
    }
  });
}
export async function GET(request: Request) {
  return sweepApi(async () => {
    const { user } = await identity(true);
    const p = new URL(request.url).searchParams;
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).max(100000),
        historyPage: z.coerce.number().int().min(1).max(100000),
        q: z.string().max(150),
        scan: z.enum(["0", "1"]),
      })
      .safeParse({
        page: p.get("page") || 1,
        historyPage: p.get("historyPage") || 1,
        q: p.get("q") || "",
        scan: p.get("scan") || "0",
      });
    if (!parsed.success) throw new HttpError(400, "조회 조건을 확인해 주세요.");
    return {
      ...(await sweepDashboard(
        parsed.data.page,
        parsed.data.q,
        parsed.data.scan === "1",
        parsed.data.historyPage,
      )),
      canExecute: canManageFunds(user),
    };
  });
}
const amount = z.string().regex(/^\d{1,7}(\.\d{1,6})?$/);
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review"),
    userIds: z
      .array(z.string().uuid())
      .min(1)
      .max(10)
      .refine((a) => new Set(a).size === a.length),
  }),
  z.object({
    action: z.literal("approve"),
    reviewId: z.string().uuid(),
    token: z.string().regex(/^[0-9a-f]{64}$/),
    confirmation: z.literal("USDT 회수"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("settings"),
    version: z.number().int().positive(),
    enabled: z.boolean(),
    maxTopup: amount,
    reserve: amount,
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("cancel"),
    id: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
]);
function units(s: string) {
  const [a, b = ""] = s.split(".");
  return BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
}
export async function POST(request: Request) {
  return sweepApi(async () => {
    checkOrigin(request);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        "회수 대상·확인 문구·사유·한도를 확인해 주세요.",
      );
    const p = parsed.data;
    const { user } = await identity(true, p.action !== "review");
    if (p.action === "review") return previewSweeps(user.id, p.userIds);
    if (p.action === "approve")
      return approveSweeps(p.reviewId, p.token, user.id, p.reason);
    return transaction(async (db) => {
      if (p.action === "cancel")
        return cancelSweep(db, p.id, user.id, p.reason);
      const max = units(p.maxTopup),
        reserve = units(p.reserve);
      if (max > 100000000n || reserve < 1000000n || reserve > 1000000000000n)
        throw new HttpError(
          400,
          "건당 보충 한도는 0~100 TRX, 회사 최소 보유량은 1~1,000,000 TRX입니다.",
        );
      if (p.enabled) {
        const runtime = sweepRuntime(await companyWalletAddress(db));
        if (runtime.issues.length) throw new HttpError(409, runtime.issues.join(" · "));
      }
      const s = await db.query(
        "UPDATE sweep_settings SET enabled=$1,max_topup=$2,company_reserve=$3,version=version+1,updated_at=now() WHERE id=true AND version=$4 RETURNING *",
        [p.enabled, max.toString(), reserve.toString(), p.version],
      );
      if (!s.rows.length)
        throw new HttpError(409, "설정이 변경됐습니다. 새로고침하세요.");
      await db.query(
        "INSERT INTO audit_logs(actor,action,details) VALUES($1,'sweep.settings',$2)",
        [user.id, JSON.stringify({ ...p, version: s.rows[0].version })],
      );
      return { settings: s.rows[0] };
    });
  });
}
