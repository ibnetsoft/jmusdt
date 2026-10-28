import type { SupabaseClient } from "@supabase/supabase-js";
import { database } from "./db";
// A verified JWT can outlive a global logout; require the server-side session too.
export async function verifiedAuthSession(auth: SupabaseClient) {
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user?.email || !user.email_confirmed_at) return null;
  const claims = await auth.auth.getClaims();
  const sessionId = claims.data?.claims.session_id;
  if (
    claims.error ||
    typeof sessionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(sessionId)
  )
    return null;
  const session = await database().query(
    "SELECT 1 FROM auth.sessions WHERE id=$1 AND user_id=$2",
    [sessionId, user.id],
  );
  return session.rows.length
    ? { user: { ...user, email: user.email }, sessionId }
    : null;
}
