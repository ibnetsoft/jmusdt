import { api, identity } from "@/lib/http";
import { database } from "@/lib/db";
export async function GET() {
  return api(async () => {
    const { user } = await identity();
    const db = database();
    const [rewards, totals, debt] = await Promise.all([
      db.query(
        "SELECT r.*,r.due_date::text AS due_date,o.product_name FROM marketing_rewards r JOIN shop_orders o ON o.id=r.order_id WHERE r.user_id=$1 ORDER BY r.created_at DESC,r.installment DESC LIMIT 200",
        [user.id],
      ),
      db.query(
        "SELECT type,status,sum(amount)::text AS amount,count(*)::int AS count FROM marketing_rewards WHERE user_id=$1 GROUP BY type,status",
        [user.id],
      ),
      db.query(
        "SELECT coalesce(sum(outstanding),0)::text AS amount FROM marketing_debts WHERE user_id=$1",
        [user.id],
      ),
    ]);
    return {
      rewards: rewards.rows,
      totals: totals.rows,
      debt: debt.rows[0].amount,
    };
  });
}
