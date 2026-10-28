import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
export async function GET(request: Request) {
  return api(async () => {
    await identity(true);
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") || "").slice(0, 150),
      status = params.get("status") || "all";
    if (
      !["all", "paid", "cancellation_requested", "cancelled"].includes(status)
    )
      throw new HttpError(400, "상태를 확인해 주세요.");
    const orders = await database().query(
      "SELECT o.*,p.email,p.name AS member_name, CASE WHEN s.order_id IS NULL THEN NULL ELSE json_build_object('recipient',s.recipient,'phone',s.phone,'address',s.address,'note',s.note,'status',s.status,'carrier',s.carrier,'tracking_number',s.tracking_number) END AS shipping FROM shop_orders o JOIN profiles p ON p.id=o.user_id LEFT JOIN shop_order_shipping s ON s.order_id=o.id WHERE ($1='all' OR o.status=$1) AND ($2='' OR o.id::text ILIKE '%'||$2||'%' OR o.product_name ILIKE '%'||$2||'%' OR p.email ILIKE '%'||$2||'%' OR p.name ILIKE '%'||$2||'%') ORDER BY o.created_at DESC LIMIT 200",
      [status, q],
    );
    return { orders: orders.rows };
  });
}
const input = z.object({
  orderId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1).max(500),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(400, "주문·처리 사유를 확인해 주세요.");
    const p = parsed.data;
    if (p.action === "approve") {
      try {
        return {
          transactionId: (
            await database().query("SELECT shop_refund($1,$2,$3) AS id", [
              p.orderId,
              user.id,
              p.reason,
            ])
          ).rows[0].id,
        };
      } catch (e) {
        if (e instanceof Error && e.message.includes("ORDER_NOT_FOUND"))
          throw new HttpError(404, "주문을 찾을 수 없습니다.");
        throw e;
      }
    }
    return transaction(async (db) => {
      const result = await db.query(
        "UPDATE shop_orders SET status='paid' WHERE id=$1 AND status='cancellation_requested' RETURNING id",
        [p.orderId],
      );
      if (!result.rows.length)
        throw new HttpError(409, "취소 요청 상태의 주문만 반려할 수 있습니다.");
      await db.query(
        "INSERT INTO audit_logs(actor,action,details) VALUES($1,'order.cancellation_rejected',$2)",
        [user.id, JSON.stringify({ orderId: p.orderId, reason: p.reason })],
      );
      return { ok: true };
    });
  });
}
