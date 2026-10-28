import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
import { orderInput, commerceError } from "@/lib/commerce";
export async function GET() {
  return api(async () => {
    const { user } = await identity();
    const [products, orders, balance] = await Promise.all([
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
    ]);
    return {
      products: products.rows,
      orders: orders.rows,
      available: balance.rows[0].available,
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
      const result = await database().query(
        "SELECT shop_purchase($1,$2,$3,$4,$5) AS id",
        [user.id, p.productId, p.quantity, p.version, p.requestKey],
      );
      return { id: result.rows[0].id };
    } catch (error) {
      commerceError(error);
    }
  });
}
