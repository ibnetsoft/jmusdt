import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { organizationTree } from "@/lib/organization";
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
    const tree = await organizationTree(
      user.id,
      p.data.mode,
      p.data.root || user.id,
      p.data.depth,
    );
    return { ...tree, accountId: user.id };
  });
}
// Placement is determined by qualification order; browser requests cannot override it.
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    await identity();
    throw new HttpError(409, "후원 조직은 정회원 등록 순서에 따라 자동 배치됩니다.");
  });
}
