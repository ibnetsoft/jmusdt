import { NextResponse } from "next/server";
import { z } from "zod";
import { authClient } from "@/lib/supabase";
import { checkOrigin } from "@/lib/http";
import { verifiedAuthSession } from "@/lib/auth-session";
import { issueRecoveryGrant } from "@/lib/password-recovery";
const input = z.object({
  // GoTrue hashes may include a PKCE prefix and are not always SHA-256 hex.
  token_hash: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  type: z.enum(["email", "signup", "recovery"]),
});
function failure() {
  return NextResponse.redirect(
    new URL("/login?error=confirmation", process.env.APP_ORIGIN),
    303,
  );
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams,
    parsed = input.safeParse({
      token_hash: params.get("token_hash"),
      type: params.get("type"),
    });
  if (!parsed.success) return failure();
  const recovery = parsed.data.type === "recovery",
    title = recovery ? "비밀번호 재설정" : "이메일 인증";
  // Mail preview/security scanners must not consume the one-use token on GET.
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>JMUSDT ${title}</title><style>body{margin:0;background:#111;color:#fff;font:16px system-ui,sans-serif}main{max-width:420px;margin:12vh auto;padding:24px}p{color:#aaa;line-height:1.7}button{width:100%;border:0;border-radius:30px;padding:18px;background:#ef3035;color:white;font:inherit;cursor:pointer}a{color:#ccc}</style></head><body><main><p>JMUSDT</p><h1>${title}</h1><p>${recovery ? "아래 버튼을 눌러 새 비밀번호 설정을 계속하세요." : "아래 버튼을 눌러 회원가입 이메일 인증을 완료하세요."}</p><form method="post" action="/auth/confirm"><input type="hidden" name="token_hash" value="${parsed.data.token_hash}"><input type="hidden" name="type" value="${parsed.data.type}"><button type="submit">${recovery ? "비밀번호 재설정 계속" : "이메일 인증 완료"}</button></form><p><a href="/login">로그인으로 돌아가기</a></p></main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await request.formData(),
      parsed = input.safeParse({
        token_hash: body.get("token_hash"),
        type: body.get("type"),
      });
    if (!parsed.success) return failure();
    const client = await authClient();
    const result = await client.auth.verifyOtp(parsed.data);
    if (result.error) return failure();
    if (parsed.data.type === "recovery") {
      const session = await verifiedAuthSession(client);
      if (!session) return failure();
      await issueRecoveryGrant(session.user.id, session.sessionId);
      return NextResponse.redirect(
        new URL("/reset-password", process.env.APP_ORIGIN),
        303,
      );
    }
    return NextResponse.redirect(
      new URL("/login?verified=1", process.env.APP_ORIGIN),
      303,
    );
  } catch {
    return failure();
  }
}
