import { z } from "zod";
import { authClient, isDemo } from "@/lib/supabase";
import { api, checkOrigin, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
import { clearRecoveryGrant } from "@/lib/password-recovery";
const schema = z.object({
  action: z.enum(["login", "signup"]),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(60).optional(),
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-F0-9]{12}$/)
    .optional(),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    if (isDemo())
      throw new HttpError(
        503,
        "현재 데모 모드입니다. Supabase 연결 후 실제 로그인을 사용할 수 있습니다.",
      );
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        "이메일과 12자 이상의 비밀번호를 확인해 주세요.",
      );
    const client = await authClient();
    const { action, email, password, name, referralCode } = parsed.data;
    if (action === "login") await clearRecoveryGrant();
    if (action === "signup" && referralCode) {
      const ref = await database().query(
        "SELECT n.user_id FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.referral_code=$1 AND p.status='active'",
        [referralCode],
      );
      if (!ref.rows.length)
        throw new HttpError(400, "추천 코드를 확인해 주세요.");
    }
    const result =
      action === "login"
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({
            email,
            password,
            options: {
              data: {
                name: name || email.split("@")[0],
                referral_code: referralCode,
              },
              emailRedirectTo: `${process.env.APP_ORIGIN}/auth/callback`,
            },
          });
    if (result.error)
      throw new HttpError(
        result.error.code === "over_email_send_rate_limit" ? 429 : 400,
        action === "login"
          ? "이메일, 비밀번호 또는 이메일 인증 상태를 확인해 주세요."
          : result.error.code === "email_address_invalid"
            ? "이메일 주소를 확인해 주세요. 실제 수신 가능한 주소를 사용해 주세요."
            : result.error.code === "email_address_not_authorized"
              ? "인증 메일 발송 설정이 필요합니다. 관리자에게 SMTP 설정을 요청해 주세요."
              : result.error.code === "over_email_send_rate_limit"
                ? "인증 메일 발송 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
                : "회원가입을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    return {
      ok: true,
      confirmationRequired: action === "signup" && !result.data.session,
    };
  });
}
export async function DELETE(request: Request) {
  return api(async () => {
    checkOrigin(request);
    if (!isDemo()) {
      const auth = await authClient();
      await auth.auth.signOut();
      await clearRecoveryGrant();
    }
    return { ok: true };
  });
}
