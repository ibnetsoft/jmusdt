import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { requestTransfer, requestWithdrawal, requestJinmuPurchase } from "@/lib/wallet-service";
const schema = z.object({
  kind: z.enum(["internal", "external", "jinmu"]),
  recipient: z.string().min(3).max(254),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
  key: z.string().uuid(),
});
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "송금 정보를 확인해 주세요.");
    const { kind, recipient, amount, key } = parsed.data;
    if (kind === "jinmu") return requestJinmuPurchase(user.id, recipient, amount, key);
    return kind === "internal"
      ? requestTransfer(user.id, recipient, amount, key)
      : requestWithdrawal(user.id, recipient, amount, key);
  });
}
