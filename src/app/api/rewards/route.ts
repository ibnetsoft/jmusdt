import { api, identity } from "@/lib/http";
import { database } from "@/lib/db";
export async function GET() {
  return api(async () => {
    const { user } = await identity();
    const db = database();
    const [rewards, totals, debt, pools, packages] = await Promise.all([
      db.query(
        "SELECT r.*,r.due_date::text AS due_date,o.product_name FROM marketing_rewards r JOIN shop_orders o ON o.id=r.order_id WHERE r.user_id=$1 AND r.type IN ('referral','sponsor','mom','daily') ORDER BY r.created_at DESC,r.installment DESC",
        [user.id],
      ),
      db.query(
        "SELECT type,status,sum(amount)::text AS amount,count(*)::int AS count FROM marketing_rewards WHERE user_id=$1 AND type IN ('referral','sponsor','mom','daily') GROUP BY type,status",
        [user.id],
      ),
      db.query(
        "SELECT coalesce(sum(outstanding),0)::text AS amount FROM marketing_debts WHERE user_id=$1",
        [user.id],
      ),
      db.query("SELECT r.kind,r.cutoff,p.quantity,p.amount::text FROM daily_pool_payments p JOIN daily_pool_runs r ON r.id=p.run_id WHERE p.user_id=$1 ORDER BY r.cutoff DESC",[user.id]),
      db.query("SELECT package_type,sum(quantity)::text AS quantity FROM shop_orders WHERE user_id=$1 AND package_type IN ('lucky','treasure') AND status IN ('paid','cancellation_requested') GROUP BY package_type",[user.id]),
    ]);
    return {
      accountId: user.id,
      rewards: rewards.rows,
      totals: totals.rows,
      debt: debt.rows[0].amount,
      pools: pools.rows,
      packages: packages.rows,
    };
  });
}
