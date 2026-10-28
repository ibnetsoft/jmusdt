import { z } from "zod";
import { parseUsdt } from "./money";
import { HttpError } from "./http";
import { detailBlocksSchema } from "./product-content";
import { rewardPlanInput } from "./marketing-plan";
export const productInput = z.object({
  id: z.string().uuid().optional(),
  version: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(20000),
  detailBlocks: detailBlocksSchema.optional(),
  rewardPlan: rewardPlanInput.optional(),
  imageUrl: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .max(2000)
      .refine((v) => v.startsWith("https://")),
  ]),
  price: z.string().regex(/^\d{1,10}(\.\d{1,6})?$/),
  stock: z.number().int().min(0).max(1000000),
  active: z.boolean(),
  shippingType: z.enum(["physical", "none"]),
  packageType: z.enum(["none", "lucky", "treasure"]).optional(),
});
export function productPrice(price: string) {
  try {
    return parseUsdt(price).toString();
  } catch {
    throw new HttpError(
      400,
      "0보다 큰 금액을 소수점 6자리 이내로 입력해 주세요.",
    );
  }
}
export const orderInput = z.object({
  shipping: z.object({
    recipient: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(1).max(40),
    address: z.string().trim().min(1).max(500),
    note: z.string().trim().max(500),
  }).optional(),
  marketingVersion: z.number().int().positive().optional(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  version: z.number().int().positive(),
  requestKey: z.string().uuid(),
});
export function commerceError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  for (const [code, text] of Object.entries({
    INSUFFICIENT_POINTS:
      "사용 가능한 포인트가 부족합니다. USDT를 포인트로 전환해 주세요.",
    PRODUCT_UNAVAILABLE: "판매 중인 상품이 아닙니다.",
    PRICE_CHANGED: "상품 정보가 변경됐습니다. 새로고침 후 다시 확인해 주세요.",
    OUT_OF_STOCK: "재고가 부족합니다.",
    INVALID_ORDER: "주문 정보를 확인해 주세요.",
  })) {
    if (message.includes(code)) throw new HttpError(409, text);
  }
  throw error;
}
