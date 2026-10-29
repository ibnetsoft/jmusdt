import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
import { orderInput, commerceError } from "@/lib/commerce";
export async function GET(request: Request) {
  return api(async () => {
    const { user } = await identity();
    const catalogOnly = new URL(request.url).searchParams.get("catalog") === "1";
    const [products, orders, balance, marketing] = await Promise.all([
      database().query(
        "SELECT * FROM shop_products WHERE active AND shipping_type IS NOT NULL ORDER BY created_at DESC",
      ),
      catalogOnly ? Promise.resolve({ rows: [] }) : database().query(
        "SELECT o.*, CASE WHEN s.order_id IS NULL THEN NULL ELSE json_build_object('recipient',s.recipient,'phone',s.phone,'address',s.address,'note',s.note,'status',s.status,'carrier',s.carrier,'tracking_number',s.tracking_number) END AS shipping FROM shop_orders o LEFT JOIN shop_order_shipping s ON s.order_id=o.id WHERE o.user_id=$1 ORDER BY o.created_at DESC",
        [user.id],
      ),
      database().query(
        "SELECT coalesce((SELECT available FROM point_balances WHERE user_id=$1),0)::text AS available",
        [user.id],
      ),
      database().query(
        "SELECT enabled,daily_paused,version FROM marketing_settings WHERE id=true",
      ),
    ]);
    return {
      accountId: user.id,
      products: products.rows,
      orders: orders.rows,
      available: balance.rows[0].available,
      marketing: marketing.rows[0],
    };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    const parsed = orderInput.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "주문 정보를 확인해 주세요.");
    const p = parsed.data;
    try {
      return await transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(9692027)");
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||$2::text,0))", [user.id, p.requestKey]);
        const settings = await db.query(
          "SELECT version FROM marketing_settings WHERE id=true FOR SHARE",
        );
        const existing = await db.query(
          "SELECT o.id, s.recipient, s.phone, s.address, s.note FROM shop_orders o LEFT JOIN shop_order_shipping s ON s.order_id=o.id WHERE o.user_id=$1 AND o.request_key=$2",
          [user.id, p.requestKey],
        );
        if (
          !existing.rows.length &&
          p.marketingVersion !== undefined &&
          p.marketingVersion !== settings.rows[0].version
        )
          throw new HttpError(
            409,
            "마케팅 운영 설정이 변경됐습니다. 상품을 새로고침한 뒤 다시 확인해 주세요.",
          );
        if (!existing.rows.length) {
          const product = (await db.query("SELECT shipping_type FROM shop_products WHERE id=$1 FOR UPDATE", [p.productId])).rows[0];
          if (product && !product.shipping_type) throw new HttpError(409, "배송 유형을 확인 중인 상품입니다.");
          if (product?.shipping_type === "physical" && !p.shipping) throw new HttpError(400, "실물 상품의 배송 정보를 입력해 주세요.");
          if (product?.shipping_type === "none" && p.shipping) throw new HttpError(400, "배송이 필요 없는 상품입니다.");
        }
        const result = await db.query(
          "SELECT shop_purchase($1,$2,$3,$4,$5) AS id",
          [user.id, p.productId, p.quantity, p.version, p.requestKey],
        );
        if (existing.rows.length) {
          const saved = existing.rows[0];
          const old = saved.recipient === null ? null : { recipient: saved.recipient, phone: saved.phone, address: saved.address, note: saved.note };
          if (JSON.stringify(old) !== JSON.stringify(p.shipping ?? null)) throw new HttpError(409, "이미 처리된 주문의 배송 정보가 다릅니다.");
        } else if (p.shipping) {
          await db.query("INSERT INTO shop_order_shipping(order_id,recipient,phone,address,note) VALUES($1,$2,$3,$4,$5)", [result.rows[0].id,p.shipping.recipient,p.shipping.phone,p.shipping.address,p.shipping.note]);
        }
        return { id: result.rows[0].id };
      });
    } catch (error) {
      commerceError(error);
    }
  });
}
