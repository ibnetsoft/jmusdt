import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
import { productPrice, commerceError } from "@/lib/commerce";
const input = z.object({
  direction: z.enum(["usdt_to_points", "points_to_usdt"]),
  amount: z.string().regex(/^\d{1,10}(\.\d{1,6})?$/),
  requestKey: z.string().uuid(),
});
export async function GET() {
  return api(async () => {
    const { user } = await identity();
    const balance = await database().query(
      "SELECT b.available AS usdt,coalesce(p.available,0)::text AS points FROM balances b LEFT JOIN point_balances p ON p.user_id=b.user_id WHERE b.user_id=$1",
      [user.id],
    );
    const history = await database().query(
      "SELECT * FROM point_swaps WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [user.id],
    );
    return { ...balance.rows[0], history: history.rows };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        "전환 방향과 금액을 확인해 주세요. 소수점 6자리까지 가능합니다.",
      );
    const p = parsed.data;
    try {
      const result = await database().query(
        "SELECT wallet_swap($1,$2,$3,$4) AS id",
        [user.id, p.direction, productPrice(p.amount), p.requestKey],
      );
      return { id: result.rows[0].id };
    } catch (e) {
      commerceError(e);
    }
  });
}
