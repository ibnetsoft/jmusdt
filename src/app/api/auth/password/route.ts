import { z } from "zod";
import { cookies } from "next/headers";
import { api, checkOrigin, HttpError } from "@/lib/http";
import { authClient } from "@/lib/supabase";
import { verifiedAuthSession } from "@/lib/auth-session";
import { transaction, database } from "@/lib/db";
import {
  RECOVERY_COOKIE,
  recoveryHash,
  validRecoveryCookie,
  clearRecoveryGrant,
} from "@/lib/password-recovery";
async function context() {
  const auth = await authClient(),
    session = await verifiedAuthSession(auth),
    token = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (!session || !validRecoveryCookie(token))
    throw new HttpError(
      403,
      "유효한 비밀번호 재설정 메일 링크로 다시 접속해 주세요.",
    );
  return { auth, ...session, hash: recoveryHash(token) };
}
export async function GET() {
  return api(async () => {
    const c = await context();
    const result = await database().query(
      "SELECT 1 FROM password_recovery_grants WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
      [c.hash, c.user.id, c.sessionId],
    );
    if (!result.rows.length)
      throw new HttpError(
        403,
        "재설정 링크가 만료되었거나 이미 사용되었습니다.",
      );
    return { valid: true };
  });
}
const input = z
  .object({
    password: z.string().min(12).max(128),
    confirmation: z.string().min(12).max(128),
  })
  .refine((v) => v.password === v.confirmation);
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        "12자 이상의 새 비밀번호와 확인값을 동일하게 입력해 주세요.",
      );
    const c = await context();
    await transaction(async (db) => {
      const ticket = await db.query(
        "UPDATE password_recovery_grants SET consumed_at=now() WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING user_id",
        [c.hash, c.user.id, c.sessionId],
      );
      if (!ticket.rows.length)
        throw new HttpError(
          403,
          "재설정 링크가 만료되었거나 이미 사용되었습니다.",
        );
      const { error } = await c.auth.auth.updateUser({
        password: parsed.data.password,
      });
      if (error)
        throw new HttpError(
          error.code === "insufficient_aal" ? 403 : 400,
          error.code === "insufficient_aal"
            ? "2단계 인증을 완료한 후 다시 저장해 주세요."
            : error.code === "same_password"
              ? "이전과 다른 비밀번호를 입력해 주세요."
              : "비밀번호를 변경하지 못했습니다. 비밀번호 조건을 확인해 주세요.",
        );
      await db.query(
        "INSERT INTO audit_logs(actor,action,details) VALUES($1,'auth.password_recovered','{}')",
        [c.user.id],
      );
    });
    let logout = await c.auth.auth.signOut({ scope: "global" });
    if (logout.error) logout = await c.auth.auth.signOut({ scope: "global" });
    await clearRecoveryGrant();
    if (logout.error)
      throw new HttpError(
        503,
        "비밀번호는 변경되었지만 모든 기기의 로그아웃을 완료하지 못했습니다. 새 비밀번호로 로그인해 관리자에게 문의해 주세요.",
      );
    return { ok: true };
  });
}
