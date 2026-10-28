import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { organizationTree } from "@/lib/organization";
import { database } from "@/lib/db";
const query = z.object({
  mode: z.enum(["referral", "sponsor"]),
  root: z.string().uuid().optional(),
  depth: z.coerce.number().refine((n) => [0, 3, 5, 10, 15, 20].includes(n)),
});
export async function GET(request: Request) {
  return api(async () => {
    const { user } = await identity();
    const params = new URL(request.url).searchParams;
    const p = query.safeParse({
      mode: params.get("mode") || "sponsor",
      root: params.get("root") || undefined,
      depth: params.get("depth") ?? 3,
    });
    if (!p.success)
      throw new HttpError(400, "조직도 조회 조건을 확인해 주세요.");
    return organizationTree(
      user.id,
      p.data.mode,
      p.data.root || user.id,
      p.data.depth,
    );
  });
}
const placement = z.object({
  memberId: z.string().uuid(),
  sponsorId: z.string().uuid(),
  position: z.enum(["L", "R"]),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    const p = placement.safeParse(await request.json());
    if (!p.success)
      throw new HttpError(400, "배치할 회원과 좌·우 자리를 확인해 주세요.");
    try {
      await database().query("SELECT network_place($1,$2,$3,$4)", [
        user.id,
        p.data.memberId,
        p.data.sponsorId,
        p.data.position,
      ]);
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const labels: Record<string, string> = {
        NOT_MY_REFERRAL: "직접 추천한 미배치 정상 회원만 배치할 수 있습니다.",
        NETWORK_CYCLE: "본인 또는 하위 회원 아래로 순환 배치할 수 없습니다.",
        OUTSIDE_NETWORK: "본인의 후원 산하에만 배치할 수 있습니다.",
        INVALID_SPONSOR: "후원할 정상 회원을 확인해 주세요.",
        ALREADY_PLACED: "이미 배치된 회원의 위치는 변경할 수 없습니다.",
        SLOT_OCCUPIED:
          "이미 사용 중인 자리입니다. 새로고침 후 다른 자리를 선택하세요.",
      };
      for (const [code, text] of Object.entries(labels))
        if (message.includes(code)) throw new HttpError(409, text);
      throw e;
    }
  });
}
