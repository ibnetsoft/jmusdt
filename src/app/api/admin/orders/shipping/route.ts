import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { transaction } from "@/lib/db";

const input = z.object({
  orderId: z.string().uuid(),
  expectedStatus: z.enum(["preparing", "shipped", "delivered"]),
  status: z.enum(["preparing", "shipped", "delivered"]),
  carrier: z.string().trim().max(100),
  trackingNumber: z.string().trim().max(100),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "배송 정보를 확인해 주세요.");
    const p = parsed.data;
    if (p.status !== "preparing" && (!p.carrier || !p.trackingNumber))
      throw new HttpError(400, "택배사와 송장번호를 입력해 주세요.");
    return transaction(async (db) => {
      const order = (await db.query("SELECT status FROM shop_orders WHERE id=$1 FOR UPDATE", [p.orderId])).rows[0];
      if (!order) throw new HttpError(404, "주문을 찾을 수 없습니다.");
      if (order.status !== "paid") throw new HttpError(409, "결제 완료 상태에서만 배송을 처리할 수 있습니다.");
      const shipping = (await db.query("SELECT status FROM shop_order_shipping WHERE order_id=$1 FOR UPDATE", [p.orderId])).rows[0];
      if (!shipping) throw new HttpError(404, "배송 정보가 없는 주문입니다.");
      if (shipping.status !== p.expectedStatus) throw new HttpError(409, "배송 상태가 변경되었습니다. 다시 조회해 주세요.");
      const allowed: Record<string, string[]> = { preparing: ["preparing", "shipped"], shipped: ["shipped", "delivered"], delivered: ["delivered"] };
      if (!allowed[shipping.status].includes(p.status)) throw new HttpError(409, "배송 상태를 되돌릴 수 없습니다.");
      await db.query("UPDATE shop_order_shipping SET status=$2,carrier=$3,tracking_number=$4,updated_at=now() WHERE order_id=$1", [p.orderId,p.status,p.carrier,p.trackingNumber]);
      await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'order.shipping_updated',$2)", [user.id, JSON.stringify({orderId:p.orderId,from:shipping.status,to:p.status})]);
      return {ok:true};
    });
  });
}
