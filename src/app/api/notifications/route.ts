import { api, identity } from "@/lib/http";
import { database } from "@/lib/db";

export async function GET(request: Request) {
  return api(async () => {
    const { user } = await identity();
    const language = new URL(request.url).searchParams.get("lang");
    // Identifiers come from this closed list, never directly from the request.
    const suffix = language === "en" || language === "ja" ? language : "ko";
    const result = await database().query(
      `SELECT id,title_${suffix} AS title,body_${suffix} AS body,created_at FROM announcements ORDER BY created_at DESC,id DESC LIMIT 200`,
    );
    return { accountId: user.id, notifications: result.rows };
  });
}
