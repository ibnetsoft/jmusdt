import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
import { productInput, productPrice } from "@/lib/commerce";
import { planBudget, planUnits } from "@/lib/marketing-plan";
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
    if (
      plan &&
      (planBudget(plan) > BigInt(price) ||
        (BigInt(plan.daily) === 0n) !== (plan.days === 0))
    )
      throw new HttpError(
        400,
        "보상 총액(데일리 전체 기간 포함)은 상품 가격 이하여야 하며, 데일리 금액과 일수를 함께 입력해야 합니다.",
      );
    return transaction(async (db) => {
      const values = [
        p.name,
        p.description,
        p.imageUrl,
        price,
        p.stock,
        p.active,
        p.detailBlocks === undefined ? null : JSON.stringify(p.detailBlocks),
        plan ? JSON.stringify(plan) : null,
      ];
      const result = p.id
        ? await db.query(
            "UPDATE shop_products SET name=$1,description=$2,image_url=$3,price=$4,stock=$5,active=$6,detail_blocks=COALESCE($7::jsonb,detail_blocks),reward_plan=COALESCE($8::jsonb,reward_plan),version=version+1,updated_at=now() WHERE id=$9 AND version=$10 RETURNING *",
            [...values, p.id, p.version],
          )
        : await db.query(
            'INSERT INTO shop_products(name,description,image_url,price,stock,active,detail_blocks,reward_plan) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::jsonb,\'[]\'::jsonb),COALESCE($8::jsonb,\'{"referral":"0","sponsor":"0","mom":"0","daily":"0","days":0,"lucky":0,"treasure":0}\'::jsonb)) RETURNING *',
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
          }),
        ],
      );
      return { product: result.rows[0] };
    });
  });
}
