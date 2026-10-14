import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
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
      await transaction(async (client) => {
        const address = await client.query(
          "SELECT address FROM deposit_addresses WHERE user_id=$1 AND address IS NOT NULL",
          [id],
        );
        if (!address.rowCount)
          throw new HttpError(400, "회수할 입금 주소가 없습니다.");
        await client.query(
          "INSERT INTO sweep_jobs(user_id,note) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [id, reason],
        );
        await client.query(
          "INSERT INTO audit_logs(actor,action,details) VALUES($1,$2,$3)",
          [user.id, "sweep.requested", JSON.stringify({ user_id: id, reason })],
        );
      });
    return { ok: true };
  });
}
