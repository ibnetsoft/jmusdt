import { z } from "zod";
import { api, checkOrigin, HttpError, identity } from "@/lib/http";
import { transaction } from "@/lib/db";
import { commerceError, orderInput } from "@/lib/commerce";

const checkoutInput = z.object({ items: z.array(orderInput).min(1).max(50) }).refine(
  ({ items }) => new Set(items.map(item => item.productId)).size === items.length && new Set(items.map(item => item.requestKey)).size === items.length,
);

export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    const parsed = checkoutInput.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "주문 정보를 확인해 주세요.");
    try {
      return await transaction(async db => {
        await db.query("SELECT pg_advisory_xact_lock(9692027)");
        const settings = await db.query("SELECT version FROM marketing_settings WHERE id=true FOR SHARE");
        const ids: string[] = [];
        for (const item of parsed.data.items) {
          await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||$2::text,0))", [user.id, item.requestKey]);
          const existing = await db.query("SELECT o.id, s.recipient, s.phone, s.address, s.note FROM shop_orders o LEFT JOIN shop_order_shipping s ON s.order_id=o.id WHERE o.user_id=$1 AND o.request_key=$2", [user.id, item.requestKey]);
          if (!existing.rows.length && item.marketingVersion !== undefined && item.marketingVersion !== settings.rows[0].version)
            throw new HttpError(409, "마케팅 운영 설정이 변경됐습니다. 상품을 새로고침한 뒤 다시 확인해 주세요.");
          if (!existing.rows.length) {
            const product = (await db.query("SELECT shipping_type FROM shop_products WHERE id=$1 FOR UPDATE", [item.productId])).rows[0];
            if (product && !product.shipping_type) throw new HttpError(409, "배송 유형을 확인 중인 상품입니다.");
            if (product?.shipping_type === "physical" && !item.shipping) throw new HttpError(400, "실물 상품의 배송 정보를 입력해 주세요.");
            if (product?.shipping_type === "none" && item.shipping) throw new HttpError(400, "배송이 필요 없는 상품입니다.");
          }
          const result = await db.query("SELECT shop_purchase($1,$2,$3,$4,$5) AS id", [user.id, item.productId, item.quantity, item.version, item.requestKey]);
          if (existing.rows.length) {
            const saved = existing.rows[0];
            const old = saved.recipient === null ? null : { recipient: saved.recipient, phone: saved.phone, address: saved.address, note: saved.note };
            if (JSON.stringify(old) !== JSON.stringify(item.shipping ?? null)) throw new HttpError(409, "이미 처리된 주문의 배송 정보가 다릅니다.");
          } else if (item.shipping) {
            await db.query("INSERT INTO shop_order_shipping(order_id,recipient,phone,address,note) VALUES($1,$2,$3,$4,$5)", [result.rows[0].id,item.shipping.recipient,item.shipping.phone,item.shipping.address,item.shipping.note]);
          }
          ids.push(result.rows[0].id);
        }
        return { ids };
      });
    } catch (error) { commerceError(error); }
  });
}
