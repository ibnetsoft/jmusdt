import { timingSafeEqual } from "node:crypto";
import { api, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
export const maxDuration = 300;
export async function GET(request: Request) {
  return api(async () => {
    const secret = process.env.CRON_SECRET;
    const given = Buffer.from(request.headers.get("authorization") || "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      !secret ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    )
      throw new HttpError(401, "인증이 필요합니다.");
    const start = Date.now();
    let paid = 0;
    for (let i = 0; i < 10 && Date.now() - start < 220000; i++) {
      const n = (await database().query("SELECT marketing_run_daily() AS paid"))
        .rows[0].paid as number;
      paid += n;
      if (n === 0) break;
    }
    const due = await database().query("SELECT kind,cutoff FROM daily_pool_entries WHERE cutoff<=now() AND settled_at IS NULL AND cancelled_at IS NULL GROUP BY kind,cutoff ORDER BY cutoff,kind LIMIT 20");
    let poolRuns=0;
    for (const entry of due.rows) {
      if(Date.now()-start>=220000) break;
      await database().query("SELECT daily_pool_settle($1,$2)",[entry.kind,entry.cutoff]);
      poolRuns++;
    }
    await database().query(
      "INSERT INTO audit_logs(action,details) VALUES('marketing.cron',$1)",
      [JSON.stringify({ paid, poolRuns })],
    );
    return { paid, poolRuns };
  });
}
