import { Login } from "@/components/login";
import { isDemo } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    ref?: string;
    verified?: string;
    reset?: string;
  }>;
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
          ? "인증 링크가 만료되었거나 이미 사용되었습니다. 인증 메일을 다시 요청해 주세요."
          : params.verified === "1"
            ? "이메일 인증이 완료되었습니다. 로그인해 주세요."
            : params.reset === "1"
              ? "비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요."
              : ""
      }
    />
  );
}
