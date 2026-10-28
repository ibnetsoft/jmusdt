import { Login } from "@/components/login";
import { isDemo } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ref?: string }>;
}) {
  const params = await searchParams;
  return (
    <Login
      demo={isDemo()}
      initialReferralCode={
        typeof params.ref === "string" && /^[a-f0-9]{12}$/i.test(params.ref)
          ? params.ref.toUpperCase()
          : ""
      }
      initialMessage={
        params.error === "confirmation"
          ? "인증 링크가 만료되었거나 유효하지 않습니다. 가입한 브라우저에서 다시 인증하거나 로그인해 주세요."
          : ""
      }
    />
  );
}
