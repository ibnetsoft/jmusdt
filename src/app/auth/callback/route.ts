import { NextResponse } from "next/server";
import { authClient } from "@/lib/supabase";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    const client = await authClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL("/", process.env.APP_ORIGIN));
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", process.env.APP_ORIGIN),
  );
}
