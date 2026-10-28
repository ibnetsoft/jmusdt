import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
import { changeUserStatus } from "@/lib/wallet-service";
const schema = z.object({
  action: z.enum(["approve", "reject", "block", "unblock", "sweep"]),
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true, true);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(400, "대상과 처리 사유를 확인해 주세요.");
    const { action, id, reason } = parsed.data;
    if (action === "approve" || action === "reject")
      await database().query("SELECT wallet_decide_withdrawal($1,$2,$3,$4)", [
        id,
        user.id,
        action === "approve" ? "approved" : "rejected",
        reason,
      ]);
    else if (action === "block" || action === "unblock")
      await changeUserStatus(
        id,
        user.id,
        action === "block" ? "blocked" : "active",
      );
    else
      throw new HttpError(
        409,
        "USDT 모으기 화면에서 확정 잔액·회사 지갑·TRX를 검토한 후 승인하세요.",
      );
    return { ok: true };
  });
}
