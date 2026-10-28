import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { database } from "../src/lib/db";
import sharp from "sharp";
if (!process.argv.includes("--test-account"))
  throw new Error("Explicit --test-account required");
const origin = process.env.APP_ORIGIN!;
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const pool = database();
const users: string[] = [];
const cookies: string[] = [];
let productId: string | undefined;
let uploadedPath: string | undefined;
async function call(path: string, cookie?: string, body?: unknown) {
  return fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  for (const privileged of [true, false]) {
    const email = `shop-qa-${randomBytes(8).toString("hex")}@example.com`,
      password = randomBytes(24).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: privileged ? { adminConsole: true } : {},
    });
    if (error) throw new Error("QA create failed: " + error.code);
    users.push(data.user.id);
    const login = await call("/api/auth", undefined, {
      action: "login",
      email,
      password,
    });
    assert.equal(login.status, 200);
    cookies.push(
      login.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    );
  }
  assert.equal((await call("/api/shop")).status, 401);
  assert.equal((await call("/api/admin/orders", cookies[1])).status, 403);
  assert.equal((await call("/api/admin/orders", cookies[0])).status, 200);
  assert.equal(
    (
      await call("/api/orders/cancel", cookies[1], {
        orderId: crypto.randomUUID(),
        reason: "QA missing order",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/api/admin/orders", cookies[0], {
        orderId: crypto.randomUUID(),
        action: "approve",
        reason: "QA missing order",
      })
    ).status,
    404,
  );
  assert.equal((await call("/api/points")).status, 401);
  const points = await call("/api/points", cookies[1]);
  assert.equal(points.status, 200);
  assert.equal((await points.json()).points, "0");
  for (const direction of ["usdt_to_points", "points_to_usdt"]) {
    assert.equal(
      (
        await call("/api/points", cookies[1], {
          direction,
          amount: "1",
          requestKey: crypto.randomUUID(),
        })
      ).status,
      409,
    );
  }
  assert.equal((await call("/api/admin/products", cookies[1])).status, 403);
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#ef3035" },
  })
    .png()
    .toBuffer();
  async function upload(cookie: string) {
    const body = new FormData();
    body.append(
      "file",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "qa.png",
    );
    return fetch(origin + "/api/admin/products/upload", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body,
    });
  }
  assert.equal((await upload(cookies[1])).status, 403);
  const uploaded = await upload(cookies[0]);
  assert.equal(uploaded.status, 200);
  const imageUrl = (await uploaded.json()).url as string;
  uploadedPath = decodeURIComponent(
    new URL(imageUrl).pathname.split("/object/public/product-images/")[1],
  );
  assert.ok(uploadedPath.startsWith(users[0] + "/"));
  const image = await fetch(imageUrl);
  assert.equal(image.status, 200);
  assert.ok(image.headers.get("content-type")?.includes("image/webp"));
  console.log(
    "HTTP: administrator image upload, public WebP retrieval and ordinary member upload denial PASS",
  );
  const product = {
    name: "QA commerce verification",
    description: "Line one\n<script>text only</script>",
    imageUrl,
    detailBlocks: [
      { type: "heading", text: "QA heading" },
      { type: "text", text: "<script>literal text only</script>" },
      {
        type: "image",
        url: imageUrl,
        alt: "QA product",
        caption: "QA caption",
      },
    ],
    price: "1.000001",
    stock: 2,
    active: false,
  };
  const created = await call("/api/admin/products", cookies[0], product);
  assert.equal(created.status, 200);
  const saved = (await created.json()).product;
  assert.deepEqual(saved.detail_blocks, product.detailBlocks);
  productId = saved.id;
  assert.ok(
    !(await (await call("/api/shop", cookies[1])).json()).products.some(
      (p: { id: string }) => p.id === productId,
    ),
  );
  const published = await call("/api/admin/products", cookies[0], {
    ...product,
    id: productId,
    version: saved.version,
    active: true,
  });
  assert.equal(published.status, 200);
  let version = (await published.json()).product.version;
  const { detailBlocks: _blocks, ...legacyProduct } = product;
  const legacyEdit = await call("/api/admin/products", cookies[0], {
    ...legacyProduct,
    id: productId,
    version,
    active: true,
  });
  assert.equal(legacyEdit.status, 200);
  const preserved = (await legacyEdit.json()).product;
  assert.deepEqual(preserved.detail_blocks, product.detailBlocks);
  version = preserved.version;
  assert.equal(
    (
      await call("/api/admin/products", cookies[0], {
        ...product,
        id: productId,
        version: saved.version,
      })
    ).status,
    409,
  );
  const catalog = await (await call("/api/shop", cookies[1])).json();
  assert.ok(catalog.products.some((p: { id: string }) => p.id === productId));
  const denied = await call("/api/shop", cookies[1], {
    productId,
    quantity: 1,
    version,
    requestKey: crypto.randomUUID(),
  });
  assert.equal(denied.status, 409);
  console.log(
    "HTTP: admin create/publish/edit conflict, member catalog, hidden products, insufficient balance and access control PASS",
  );
  // Real PostgreSQL checkout is exercised inside a rollback-only transaction.
  // No synthetic funds, orders or journal entries survive this verification.
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("UPDATE balances SET available=2000002 WHERE user_id=$1", [
      users[1],
    ]);
    for (const [direction, amount] of [
      ["usdt_to_points", 2000002],
      ["points_to_usdt", 1],
      ["usdt_to_points", 1],
    ] as const) {
      await db.query("SELECT wallet_swap($1,$2,$3,$4)", [
        users[1],
        direction,
        amount,
        crypto.randomUUID(),
      ]);
    }
    console.log(
      "Real PostgreSQL 1:1 USDT/POINT round trip PASS (rollback-only)",
    );
    const key = crypto.randomUUID(),
      args = [users[1], productId, 2, version, key];
    const first = await db.query(
      "SELECT shop_purchase($1,$2,$3,$4,$5) AS id",
      args,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT product_detail_blocks FROM shop_orders WHERE id=$1",
          [first.rows[0].id],
        )
      ).rows[0].product_detail_blocks,
      product.detailBlocks,
    );
    assert.equal(
      (await db.query("SELECT shop_purchase($1,$2,$3,$4,$5) AS id", args))
        .rows[0].id,
      first.rows[0].id,
    );
    assert.equal(
      (
        await db.query(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [users[1]],
        )
      ).rows[0].available,
      "0",
    );
    assert.equal(
      (
        await db.query("SELECT stock FROM shop_products WHERE id=$1", [
          productId,
        ])
      ).rows[0].stock,
      0,
    );
    const journal = await db.query(
      "SELECT sum(units)::text AS net FROM journal WHERE transaction_id=(SELECT transaction_id FROM shop_orders WHERE id=$1)",
      [first.rows[0].id],
    );
    assert.equal(journal.rows[0].net, "0");
    const refundArgs = [first.rows[0].id, users[0], "QA cancellation approved"];
    const refund = await db.query(
      "SELECT shop_refund($1,$2,$3) AS id",
      refundArgs,
    );
    assert.equal(
      (await db.query("SELECT shop_refund($1,$2,$3) AS id", refundArgs)).rows[0]
        .id,
      refund.rows[0].id,
    );
    assert.equal(
      (
        await db.query(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [users[1]],
        )
      ).rows[0].available,
      "2000002",
    );
    assert.equal(
      (
        await db.query("SELECT stock FROM shop_products WHERE id=$1", [
          productId,
        ])
      ).rows[0].stock,
      2,
    );
    assert.equal(
      (
        await db.query("SELECT status FROM shop_orders WHERE id=$1", [
          first.rows[0].id,
        ])
      ).rows[0].status,
      "cancelled",
    );
    console.log(
      "Real PostgreSQL cancellation: full point refund, stock recovery and repeated approval PASS (rollback-only)",
    );
    console.log(
      "Real PostgreSQL checkout: exact 6-decimal debit, order, stock, balanced journal and duplicate request PASS (rolled back)",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
  assert.equal(
    (await (await call("/api/shop", cookies[1])).json()).orders.length,
    0,
  );
} finally {
  if (uploadedPath) {
    const removed = await admin.storage
      .from("product-images")
      .remove([uploadedPath]);
    if (removed.error) throw new Error("QA image cleanup failed");
  }
  for (const cookie of cookies)
    await fetch(origin + "/api/auth", {
      method: "DELETE",
      headers: { Origin: origin, Cookie: cookie },
    });
  if (productId)
    await pool.query(
      "DELETE FROM shop_products WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM shop_orders WHERE product_id=$1)",
      [productId],
    );
  for (const id of users) {
    await pool.query(
      "DELETE FROM point_balances WHERE user_id=$1 AND available=0",
      [id],
    );
    await pool.query("DELETE FROM audit_logs WHERE actor=$1", [id]);
    await pool.query(
      "DELETE FROM balances WHERE user_id=$1 AND available=0 AND reserved=0",
      [id],
    );
    await pool.query(
      "DELETE FROM profiles WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM transactions WHERE user_id=$1)",
      [id],
    );
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) throw new Error("QA cleanup failed");
  }
  await pool.end();
  console.log("Disposable QA data cleaned up");
}
