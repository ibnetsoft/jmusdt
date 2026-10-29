import { api, HttpError } from "@/lib/http";
import { authClient, isDemo } from "@/lib/supabase";
import { verifiedAuthSession } from "@/lib/auth-session";
import { database } from "@/lib/db";

export async function GET() {
  return api(async () => {
    if (isDemo()) throw new HttpError(403, "데모 모드");
    const session = await verifiedAuthSession(await authClient());
    if (!session) throw new HttpError(401, "로그인이 필요합니다.");
    const profile = await database().query("SELECT status FROM profiles WHERE id=$1", [session.user.id]);
    if (profile.rows[0]?.status !== "active") throw new HttpError(403, "이용이 제한된 계정입니다.");
    return { userId: session.user.id };
  });
}
