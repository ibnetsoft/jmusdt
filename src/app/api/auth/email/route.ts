import { z } from "zod";
import { api, checkOrigin, HttpError } from "@/lib/http";
import { authClient, isDemo } from "@/lib/supabase";
const input = z.object({
  action: z.enum(["resend", "recovery"]),
  email: z.string().trim().toLowerCase().email().max(254),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    if (isDemo())
      throw new HttpError(
        403,
        "이메일 인증은 실제 연결 모드에서 사용할 수 있습니다.",
      );
    const parsed = input.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(400, "올바른 이메일 주소를 입력해 주세요.");
    const { action, email } = parsed.data,
      auth = await authClient();
    const result =
      action === "resend"
        ? await auth.auth.resend({
            type: "signup",
            email,
            options: {
              emailRedirectTo: `${process.env.APP_ORIGIN}/auth/callback`,
            },
          })
        : await auth.auth.resetPasswordForEmail(email, {
            redirectTo: `${process.env.APP_ORIGIN}/auth/callback?next=reset`,
          });
    if (result.error) {
      if (
        ["over_email_send_rate_limit", "over_request_rate_limit"].includes(
          result.error.code || "",
        )
      )
        throw new HttpError(
          429,
          "메일 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        );
      if (
        ["email_address_not_authorized", "unexpected_failure"].includes(
          result.error.code || "",
        )
      )
        throw new HttpError(
          503,
          "인증 메일 발송을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      // Do not reveal whether an account is missing or already verified.
      if (
        ![
          "user_not_found",
          "email_not_confirmed",
          "email_exists",
          "email_address_invalid",
          "validation_failed",
        ].includes(result.error.code || "")
      )
        throw new HttpError(
          503,
          "메일 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
    }
    return {
      ok: true,
      message:
        action === "recovery"
          ? "등록된 이메일이면 비밀번호 재설정 메일을 보냈습니다. 메일함과 스팸함을 확인해 주세요."
          : "가입 인증이 필요한 이메일이면 인증 메일을 다시 보냈습니다. 메일함과 스팸함을 확인해 주세요.",
    };
  });
}
