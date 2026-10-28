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
    await database().query(
      "INSERT INTO audit_logs(action,details) VALUES('marketing.cron',$1)",
      [JSON.stringify({ paid })],
    );
    return { paid };
  });
}
