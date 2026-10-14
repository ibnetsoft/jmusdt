import { NextResponse } from "next/server";
import { authClient } from "@/lib/supabase";
// Email template: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tokenHash = params.get("token_hash"),
    type = params.get("type");
  if (tokenHash && (type === "email" || type === "signup")) {
    const client = await authClient();
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error)
      return NextResponse.redirect(new URL("/", process.env.APP_ORIGIN));
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", process.env.APP_ORIGIN),
  );
}
