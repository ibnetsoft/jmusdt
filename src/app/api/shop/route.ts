import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
import { orderInput, commerceError } from "@/lib/commerce";
export async function GET() {
  return api(async () => {
    const { user } = await identity();
    const [products, orders, balance, marketing] = await Promise.all([
      database().query(
        "SELECT * FROM shop_products WHERE active ORDER BY created_at DESC",
      ),
      database().query(
        "SELECT * FROM shop_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
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
        const settings = await db.query(
          "SELECT version FROM marketing_settings WHERE id=true FOR SHARE",
        );
        const existing = await db.query(
          "SELECT id FROM shop_orders WHERE user_id=$1 AND request_key=$2",
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
        const result = await db.query(
          "SELECT shop_purchase($1,$2,$3,$4,$5) AS id",
          [user.id, p.productId, p.quantity, p.version, p.requestKey],
        );
        return { id: result.rows[0].id };
      });
    } catch (error) {
      commerceError(error);
    }
  });
}
