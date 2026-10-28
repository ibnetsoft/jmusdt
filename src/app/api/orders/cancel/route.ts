import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { transaction } from "@/lib/db";
const input = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(400, "취소 사유를 1~500자로 입력해 주세요.");
    return transaction(async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM shop_orders WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [parsed.data.orderId, user.id],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "주문을 찾을 수 없습니다.");
      if (row.status === "cancelled")
        throw new HttpError(409, "이미 취소·환불된 주문입니다.");
      if (row.status === "cancellation_requested") return { ok: true };
      await db.query(
        "UPDATE shop_orders SET status='cancellation_requested',cancellation_reason=$2 WHERE id=$1",
        [row.id, parsed.data.reason],
      );
      await db.query(
        "INSERT INTO audit_logs(actor,action,details) VALUES($1,'order.cancellation_requested',$2)",
        [
          user.id,
          JSON.stringify({ orderId: row.id, reason: parsed.data.reason }),
        ],
      );
      return { ok: true };
    });
  });
}
