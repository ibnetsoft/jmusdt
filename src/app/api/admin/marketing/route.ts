import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
export async function GET(request: Request) {
  return api(async () => {
    await identity(true);
    const params = new URL(request.url).searchParams;
    const parsed = z
      .object({
        type: z.enum([
          "all",
          "referral",
          "sponsor",
          "mom",
          "lucky",
          "treasure",
          "daily",
        ]),
        status: z.enum([
          "all",
          "scheduled",
          "paid",
          "skipped",
          "reversed",
          "void",
        ]),
        q: z.string().max(150),
        page: z.coerce.number().int().min(1).max(100000),
      })
      .safeParse({
        type: params.get("type") || "all",
        status: params.get("status") || "all",
        q: params.get("q") || "",
        page: params.get("page") || 1,
      });
    if (!parsed.success) throw new HttpError(400, "검색 조건을 확인해 주세요.");
    const { type, status, q, page } = parsed.data;
    const db = database();
    const filter =
      "r.type IN ('referral','sponsor','mom','daily') AND ($1='all' OR r.type=$1) AND ($2='all' OR r.status=$2) AND ($3='' OR r.order_id::text ILIKE '%'||$3||'%' OR p.email ILIKE '%'||$3||'%' OR p.name ILIKE '%'||$3||'%')";
    const [settings, rewards, count, summary, debts, poolBalances, poolRuns] = await Promise.all([
      db.query("SELECT * FROM marketing_settings WHERE id=true"),
      db.query(
        `SELECT r.*,r.due_date::text AS due_date,o.product_name,p.name,p.email FROM marketing_rewards r JOIN shop_orders o ON o.id=r.order_id LEFT JOIN profiles p ON p.id=r.user_id WHERE ${filter} ORDER BY r.created_at DESC,r.id LIMIT 100 OFFSET $4`,
        [type, status, q, (page - 1) * 100],
      ),
      db.query(
        `SELECT count(*)::int AS count FROM marketing_rewards r LEFT JOIN profiles p ON p.id=r.user_id WHERE ${filter}`,
        [type, status, q],
      ),
      db.query(
        "SELECT type,status,sum(amount)::text AS amount,count(*)::int AS count FROM marketing_rewards WHERE type IN ('referral','sponsor','mom','daily') GROUP BY type,status",
      ),
      db.query(
        "SELECT d.user_id,p.name,p.email,sum(d.outstanding)::text AS amount FROM marketing_debts d JOIN profiles p ON p.id=d.user_id WHERE d.outstanding>0 GROUP BY d.user_id,p.name,p.email ORDER BY sum(d.outstanding) DESC LIMIT 100",
      ),
      db.query("SELECT kind,cutoff,sum(amount)::text AS amount FROM daily_pool_entries WHERE cancelled_at IS NULL AND settled_at IS NULL GROUP BY kind,cutoff ORDER BY cutoff DESC LIMIT 20"),
      db.query("SELECT kind,cutoff,total::text,distributed::text,retained::text,package_count::text FROM daily_pool_runs ORDER BY cutoff DESC,kind LIMIT 30"),
    ]);
    return {
      settings: settings.rows[0],
      rewards: rewards.rows,
      count: count.rows[0].count,
      page,
      summary: summary.rows,
      debts: debts.rows,
      poolBalances: poolBalances.rows,
      poolRuns: poolRuns.rows,
    };
  });
}
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settings"),
    version: z.number().int().positive(),
    enabled: z.boolean(),
    dailyPaused: z.boolean(),
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({ action: z.literal("daily") }),
  z.object({ action: z.literal("pools"), reason:z.string().trim().min(1).max(500) }),
]);
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(400, "설정과 변경 사유를 확인해 주세요.");
    const p = parsed.data;
    return transaction(async (db) => {
      if (p.action === "settings") {
        const result = await db.query(
          "UPDATE marketing_settings SET enabled=$1,daily_paused=$2,version=version+1,updated_at=now() WHERE id=true AND version=$3 RETURNING *",
          [p.enabled, p.dailyPaused, p.version],
        );
        if (!result.rows.length)
          throw new HttpError(
            409,
            "설정이 변경됐습니다. 새로고침 후 다시 저장해 주세요.",
          );
        await db.query(
          "INSERT INTO audit_logs(actor,action,details) VALUES($1,'marketing.settings',$2)",
          [user.id, JSON.stringify({ ...p, version: result.rows[0].version })],
        );
        return { settings: result.rows[0] };
      }
      if(p.action==="pools") {
        const due=await db.query("SELECT kind,cutoff FROM daily_pool_entries WHERE cutoff<=now() AND settled_at IS NULL AND cancelled_at IS NULL GROUP BY kind,cutoff ORDER BY cutoff,kind LIMIT 20");
        for(const entry of due.rows) await db.query("SELECT daily_pool_settle($1,$2)",[entry.kind,entry.cutoff]);
        await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'marketing.pools_retry',$2)",[user.id,JSON.stringify({reason:p.reason,runs:due.rows.length})]);
        return {poolRuns:due.rows.length};
      }
      const paid = (await db.query("SELECT marketing_run_daily() AS paid"))
        .rows[0].paid;
      await db.query(
        "INSERT INTO audit_logs(actor,action,details) VALUES($1,'marketing.daily_run',$2)",
        [user.id, JSON.stringify({ paid })],
      );
      return { paid };
    });
  });
}
