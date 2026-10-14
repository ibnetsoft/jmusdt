import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export function isDemo() {
  return process.env.APP_MODE === "demo";
}
export async function authClient() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase 인증 설정이 필요합니다.");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server components use proxy for refresh. */
        }
      },
    },
  });
}
