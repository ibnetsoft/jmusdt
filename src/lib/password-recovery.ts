import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { database } from "./db";
export const RECOVERY_COOKIE = "jmusdt_password_recovery";
export const recoveryHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function validRecoveryCookie(
  value: string | undefined,
): value is string {
  return !!value && /^[0-9a-f]{64}$/.test(value);
}
export async function issueRecoveryGrant(userId: string, sessionId: string) {
  const token = randomBytes(32).toString("hex");
  await database().query(
    "DELETE FROM password_recovery_grants WHERE expires_at<now() OR (user_id=$1 AND consumed_at IS NOT NULL)",
    [userId],
  );
  await database().query(
    "INSERT INTO password_recovery_grants(token_hash,user_id,session_id) VALUES($1,$2,$3)",
    [recoveryHash(token), userId, sessionId],
  );
  (await cookies()).set(RECOVERY_COOKIE, token, {
    httpOnly: true,
    secure: new URL(process.env.APP_ORIGIN!).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 900,
  });
}
export async function clearRecoveryGrant() {
  const jar = await cookies(),
    token = jar.get(RECOVERY_COOKIE)?.value;
  if (validRecoveryCookie(token))
    await database().query(
      "UPDATE password_recovery_grants SET consumed_at=coalesce(consumed_at,now()) WHERE token_hash=$1",
      [recoveryHash(token)],
    );
  jar.delete(RECOVERY_COOKIE);
}
