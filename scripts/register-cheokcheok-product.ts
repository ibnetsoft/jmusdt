import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect, type Browser } from "@playwright/test";
import { database, transaction } from "../src/lib/db";
import { productInput } from "../src/lib/commerce";
import { planUnits } from "../src/lib/marketing-plan";

assert.ok(process.argv.includes("--register"), "Explicit --register required");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname, "thxpejttykcdgvjjgwxv.supabase.co");
const origin = "https://jmusdt.com", pool = database();
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const input = productInput.parse({
  name: "척척보감", description: "로그인한 모든 회원에게 회원가가 적용되는 실물 배송 상품입니다.",
  imageUrl: "", price: "88000", retailPrice: "98000", stock: 10000, active: true,
  shippingType: "physical", packageType: "none", detailBlocks: [],
  rewardPlan: { referral: "9000", sponsor: "4500", mom: "4500", daily: "0", days: 0, lucky: 3000, treasure: 3000 },
});
const email = `product-qa-${randomBytes(8).toString("hex")}@example.com`, password = randomBytes(30).toString("base64url");
const directory = "artifacts/cheokcheok-product";
await mkdir(directory, { recursive: true });
let userId: string | undefined, cookie = "", browser: Browser | undefined;
let productId: string | undefined;
try {
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "QA product registration verification" }, app_metadata: { adminConsole: true } });
  if (error) throw new Error("QA account creation failed: " + error.code);
  userId = data.user.id;
  const login = await fetch(origin + "/api/auth", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email, password }) });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  async function post(path: string, body: unknown, expected = 200) {
    const response = await fetch(origin + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, result.error || "Unexpected response");
    return result;
  }
  // Invalid comparison prices must not create a product.
  await post("/api/admin/products", { ...input, retailPrice: "87000" }, 400);
  const matches = (await pool.query("SELECT * FROM shop_products WHERE name=$1", [input.name])).rows;
  assert.ok(matches.length <= 1, "Multiple matching products need review");
  const product = matches[0] || (await post("/api/admin/products", input)).product;
  productId = product.id;
  assert.equal(product.price, "88000000000");
  assert.equal(product.retail_price, "98000000000");
  assert.equal(product.shipping_type, "physical");
  assert.equal(product.package_type, "none");
  assert.equal(product.active, true);
  assert.deepEqual(product.reward_plan, planUnits(input.rewardPlan!));
  await post("/api/shop", { productId, quantity: 1, version: product.version, requestKey: crypto.randomUUID() }, 400);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(cookie.split("; ").map(s => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: origin, secure: true, sameSite: "Lax" as const }; }));
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/admin/shop");
  await page.locator(".shop-order").filter({ hasText: input.name }).getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByLabel("회원가 (실제 결제가 · P)")).toHaveValue("88000.000000");
  await expect(page.getByLabel("소비자가 (비교 표시 · P · 선택)")).toHaveValue("98000.000000");
  await expect(page.getByLabel(/^배송 유형/)).toHaveValue("physical");
  await expect(page.getByLabel("재고 수량", { exact: true })).toHaveValue(String(product.stock));
  await page.screenshot({ path: directory + "/admin-desktop.png", fullPage: true });
  await page.goto(origin + "/shop");
  const card = page.locator(".shop-card").filter({ hasText: input.name });
  await expect(card.getByText("소비자가 98,000 P", { exact: true })).toBeVisible();
  await expect(card.getByText("회원가 88,000 P", { exact: true })).toBeVisible();
  await page.screenshot({ path: directory + "/shop-desktop.png", fullPage: true });
  await card.getByRole("link", { name: "상품 상세 보기" }).click();
  await expect(page.locator(".shop-total")).toHaveText("결제금액 88,000.000000 포인트");
  await expect(page.getByLabel("배송 주소", { exact: true })).toBeVisible();
  await expect(page.getByText(/상품 1개당 데일리/)).toHaveCount(0);
  await expect(page.getByText(/복주머니P 3000 P · 보물상자P 3000 P/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("회원가 88,000 P", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: directory + "/detail-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM shop_orders WHERE user_id=$1", [userId])).rows[0].n), 0, "Catalog QA must not create orders");
  const record = { id: productId, name: input.name, url: origin + "/shop/" + productId, retailPrice: input.retailPrice, memberPrice: input.price, pricing: "All logged-in members", registeredStock: input.stock, shipping: input.shippingType, rewardPlan: input.rewardPlan, image: null };
  await writeFile("assets/products/cheokcheok-bogam.json", JSON.stringify(record, null, 2) + "\n");
  await writeFile(directory + "/verified.json", JSON.stringify({ ...record, verifiedAt: new Date().toISOString(), checks: ["Admin API and editor preserve both prices", "Comparison price below member price rejected", "Shipping missing rejected before payment", "Live desktop and mobile show 98,000 P / 88,000 P", "No daily allowance and company accrual of 3,000 P each", "No horizontal overflow or browser errors"], financialTransactionsCreated: 0 }, null, 2));
  console.log(JSON.stringify({ ...record, verification: "PASS", financialTransactionsCreated: 0 }, null, 2));
} finally {
  await browser?.close();
  if (userId) {
    if (cookie) await fetch(origin + "/api/auth", { method: "DELETE", headers: { Origin: origin, Cookie: cookie } });
    const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: "876000h", app_metadata: { adminConsole: false } });
    if (error) throw new Error("Failed to disable QA account: " + error.code);
    await transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(9692027)");
      await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [userId]);
      await db.query("INSERT INTO audit_logs(action,details) VALUES('catalog.verification_completed',$1)", [JSON.stringify({ userId, productId, name: input.name })]);
    });
  }
  await pool.end();
}
