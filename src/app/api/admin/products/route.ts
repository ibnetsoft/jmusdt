import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";
import { productInput, productPrice } from "@/lib/commerce";
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
        "상품명·가격·이미지 HTTPS 주소·재고를 확인해 주세요.",
      );
    const p = parsed.data;
    const price = productPrice(p.price);
    return transaction(async (db) => {
      const values = [
        p.name,
        p.description,
        p.imageUrl,
        price,
        p.stock,
        p.active,
      ];
      const result = p.id
        ? await db.query(
            "UPDATE shop_products SET name=$1,description=$2,image_url=$3,price=$4,stock=$5,active=$6,version=version+1,updated_at=now() WHERE id=$7 AND version=$8 RETURNING *",
            [...values, p.id, p.version],
          )
        : await db.query(
            "INSERT INTO shop_products(name,description,image_url,price,stock,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
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
          }),
        ],
      );
      return { product: result.rows[0] };
    });
  });
}
