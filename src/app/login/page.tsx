import { Login } from "@/components/login";
import { isDemo } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <Login
      demo={isDemo()}
      initialMessage={
        params.error === "confirmation"
          ? "인증 링크가 만료되었거나 유효하지 않습니다. 가입한 브라우저에서 다시 인증하거나 로그인해 주세요."
          : ""
      }
    />
  );
}
