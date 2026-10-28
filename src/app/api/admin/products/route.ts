import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
import { productInput, productPrice, productRetailPrice } from "@/lib/commerce";
import { planUnits, validRewardBudget } from "@/lib/marketing-plan";
export async function GET() {
  return api(async () => {
    await identity(true);
    return {
      products: (
        await database().query(
          "SELECT * FROM shop_products ORDER BY created_at DESC",
        )
      ).rows,
    };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true);
    const parsed = productInput.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        "상품명·가격·이미지 HTTPS 주소·재고·상세 블록·보상 설정을 확인해 주세요.",
      );
    const p = parsed.data;
    const price = productPrice(p.price);
    const plan = p.rewardPlan ? planUnits(p.rewardPlan) : undefined;
    return transaction(async (db) => {
      const existing = p.id ? (await db.query("SELECT package_type,reward_plan,retail_price FROM shop_products WHERE id=$1 FOR UPDATE",[p.id])).rows[0] : undefined;
      const requestedRetailPrice = productRetailPrice(p.retailPrice, price);
      const retailPrice = requestedRetailPrice === undefined ? existing?.retail_price ?? null : requestedRetailPrice;
      if (retailPrice !== null && BigInt(retailPrice) < BigInt(price))
        throw new HttpError(400, "소비자가는 회원가 이상으로 입력해 주세요.");
      const packageType = p.packageType ?? existing?.package_type ?? "none";
      if ((packageType === "lucky" && price !== "350000000000") || (packageType === "treasure" && price !== "3500000000000"))
        throw new HttpError(400, "복주머니패키지는 350,000 P, 보물상자패키지는 3,500,000 P로 설정해 주세요.");
      const effectivePlan = plan ?? existing?.reward_plan;
      if (effectivePlan && !validRewardBudget(effectivePlan,BigInt(price),packageType))
        throw new HttpError(400,"보상 총액은 상품 가격 이하여야 합니다. 복주머니 1,000 P·보물상자 10,000 P × 369일 데일리 전용 플랜만 예외이며, 다른 리워드·회사 적립은 0이어야 합니다.");
      const values = [
        p.name,
        p.description,
        p.imageUrl,
        price,
        p.stock,
        p.active,
        p.detailBlocks === undefined ? null : JSON.stringify(p.detailBlocks),
        plan ? JSON.stringify(plan) : null,
        p.shippingType,
        p.packageType ?? null,
        retailPrice,
      ];
      const result = p.id
        ? await db.query(
            "UPDATE shop_products SET name=$1,description=$2,image_url=$3,price=$4,stock=$5,active=$6,detail_blocks=COALESCE($7::jsonb,detail_blocks),reward_plan=COALESCE($8::jsonb,reward_plan),shipping_type=$9,package_type=COALESCE($10,package_type),retail_price=$11,version=version+1,updated_at=now() WHERE id=$12 AND version=$13 RETURNING *",
            [...values, p.id, p.version],
          )
        : await db.query(
            'INSERT INTO shop_products(name,description,image_url,price,stock,active,detail_blocks,reward_plan,shipping_type,package_type,retail_price) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::jsonb,\'[]\'::jsonb),COALESCE($8::jsonb,\'{"referral":"0","sponsor":"0","mom":"0","daily":"0","days":0,"lucky":0,"treasure":0}\'::jsonb),$9,COALESCE($10,\'none\'),$11) RETURNING *',
            values,
          );
      if (!result.rows[0])
        throw new HttpError(
          409,
          "다른 관리자가 수정했습니다. 목록을 새로고침하세요.",
        );
      await db.query(
        "INSERT INTO audit_logs(actor,action,details) VALUES($1,$2,$3)",
        [
          user.id,
          p.id ? "product.updated" : "product.created",
          JSON.stringify({
            productId: result.rows[0].id,
            version: result.rows[0].version,
            rewardPlan: result.rows[0].reward_plan,
            shippingType: result.rows[0].shipping_type,
            packageType: result.rows[0].package_type,
            price: result.rows[0].price,
            retailPrice: result.rows[0].retail_price,
          }),
        ],
      );
      return { product: result.rows[0] };
    });
  });
}
