import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
import { productPrice, commerceError } from "@/lib/commerce";
const input = z.object({
  direction: z.enum(["usdt_to_points", "points_to_usdt"]),
  amount: z.string().regex(/^\d{1,10}$/),
  requestKey: z.string().uuid(),
  rateVersion: z.number().int().positive(),
});
export async function GET() {
  return api(async () => {
    const { user } = await identity();
    const db = database();
    const [balance, history, debt, rate] = await Promise.all([db.query(
      "SELECT b.available AS usdt,coalesce(p.available,0)::text AS points FROM balances b LEFT JOIN point_balances p ON p.user_id=b.user_id WHERE b.user_id=$1",
      [user.id],
    ), db.query(
      "SELECT s.*, t.amount AS received_amount FROM point_swaps s JOIN transactions t ON t.id=s.credit_id WHERE s.user_id=$1 ORDER BY s.created_at DESC",
      [user.id],
    ), db.query(
      "SELECT coalesce(sum(outstanding),0)::text AS debt FROM marketing_debts WHERE user_id=$1",
      [user.id],
    ), db.query("SELECT rate,version FROM exchange_rate_settings WHERE id=true")]);
    return {
      accountId: user.id,
      rate: rate.rows[0].rate, rateVersion: rate.rows[0].version,
      ...balance.rows[0],
      history: history.rows,
      debt: debt.rows[0].debt,
    };
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
        "전환 방향과 정수 금액을 확인해 주세요.",
      );
    const p = parsed.data;
    try {
      const result = await database().query(
        "SELECT wallet_swap($1,$2,$3,$4,$5) AS id",
        [user.id, p.direction, productPrice(p.amount), p.requestKey, p.rateVersion],
      );
      return { id: result.rows[0].id };
    } catch (e) {
      if (e instanceof Error && e.message.includes("RATE_CHANGED")) throw new HttpError(409, "전환 비율이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      commerceError(e);
    }
  });
}
