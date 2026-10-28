import { NextResponse } from "next/server";
import { authClient, isDemo } from "./supabase";
import { isAuthorizedAdmin, canManageFunds } from "./admin-access";
import { database } from "./db";
import { verifyExistingChainBinding } from "./chain-binding";
import { verifiedAuthSession } from "./auth-session";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function identity(admin = false, funds = false) {
  if (isDemo())
    throw new HttpError(
      403,
      "데모 모드에서는 실제 자금 작업을 실행할 수 없습니다.",
    );
  const auth = await authClient();
  const session = await verifiedAuthSession(auth);
  if (!session) throw new HttpError(401, "로그인이 필요합니다.");
  const { user } = session;
  if (admin && !isAuthorizedAdmin(user))
    throw new HttpError(403, "관리자 권한이 필요합니다.");
  if (funds && !canManageFunds(user))
    throw new HttpError(403, "최고 관리자 권한이 필요합니다.");
  // Privileged actions require a verified TOTP session.
  if (funds) {
    const { data } = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2")
      throw new HttpError(403, "관리자 2단계 인증이 필요합니다.");
  }
  await verifyExistingChainBinding();
  const result = await database().query(
    `INSERT INTO profiles(id,email,name) VALUES($1,$2,$3)
    ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email RETURNING *`,
    [
      user.id,
      user.email.toLowerCase(),
      typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name.slice(0, 60)
        : user.email.split("@")[0],
    ],
  );
  await database().query(
    "INSERT INTO balances(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [user.id],
  );
  if (result.rows[0].status !== "active")
    throw new HttpError(403, "이용이 제한된 계정입니다.");
  await database().query(
    "SELECT network_activate($1)",
    [user.id],
  );
  return { user, profile: result.rows[0] };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = [
    process.env.APP_ORIGIN,
    ...(process.env.APP_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim()),
  ].filter(Boolean);
  if (!origin || !allowed.includes(origin))
    throw new HttpError(403, "요청 출처를 확인할 수 없습니다.");
}
export async function api(run: () => Promise<unknown>) {
  try {
    return NextResponse.json(await run(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    const message = error instanceof Error ? error.message : "";
    if (message.includes("product_reward_budget"))
      return NextResponse.json(
        {
          error:
            "상품의 보상 금액·지급 일수·패키지 유형을 확인해 주세요. 판매가 초과는 지정된 369일 패키지 데일리 전용 플랜만 허용됩니다.",
        },
        { status: 400 },
      );
    if (message.includes("INSUFFICIENT_BALANCE"))
      return NextResponse.json(
        { error: "사용 가능한 잔액이 부족합니다." },
        { status: 409 },
      );
    if (
      message.includes("INVALID_STATE") ||
      message.includes("IDEMPOTENCY_CONFLICT")
    )
      return NextResponse.json(
        { error: "이미 처리되었거나 요청 내용이 변경되었습니다." },
        { status: 409 },
      );
    if (message.includes("ACCOUNT_BLOCKED"))
      return NextResponse.json(
        { error: "이용이 제한된 계정입니다." },
        { status: 403 },
      );
    if (message.includes("RECIPIENT_NOT_FOUND"))
      return NextResponse.json(
        { error: "받는 회원을 찾을 수 없습니다." },
        { status: 404 },
      );
    console.error(
      "API request failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json(
      {
        error:
          "요청을 처리하지 못했습니다. 설정 또는 서비스 상태를 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
