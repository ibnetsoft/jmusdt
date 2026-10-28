import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect, type Browser } from "@playwright/test";
import { database, transaction } from "../src/lib/db";

assert.ok(process.argv.includes("--verify"), "Explicit --verify required");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname, "thxpejttykcdgvjjgwxv.supabase.co");
const origin = "https://jmusdt.com", directory = "artifacts/i18n/live", pool = database();
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
await mkdir(directory, { recursive: true });
const email = `language-qa-${randomBytes(8).toString("hex")}@example.com`, password = randomBytes(30).toString("base64url");
let userId: string | undefined, cookie = "", browser: Browser | undefined;
const results: { locale: string; path: string; status: number }[] = [];
const routes = [
  { path: "/mypage", headings: ["마이페이지", "My page", "マイページ"] },
  { path: "/points", headings: ["포인트 전환", "Point conversion", "ポイント交換"] },
  { path: "/organization", headings: ["함께 만드는 조직.", "Build your network together.", "一緒に育てる組織。"] },
  { path: "/rewards", headings: ["나의 리워드", "My rewards", "マイリワード"] },
  { path: "/admin", headings: ["대시보드", "Dashboard", "ダッシュボード"] },
  { path: "/admin/shop", headings: ["상품 관리", "Products", "商品管理"] },
  { path: "/admin/orders", headings: ["주문 관리", "Orders", "注文管理"] },
  { path: "/admin/grades", headings: ["회원등급 관리", "Membership levels", "会員ランク管理"] },
  { path: "/admin/marketing", headings: ["마케팅 관리", "Reward management", "報酬管理"] },
  { path: "/admin/branding", headings: ["로고 설정", "Logo settings", "ロゴ設定"] },
  { path: "/admin/sweeps", headings: ["USDT 모으기", "Collect USDT", "USDT集約"] },
];
try {
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "QA language verification" }, app_metadata: { adminConsole: true } });
  if (error) throw new Error("QA account creation failed: " + error.code);
  userId = data.user.id;
  const login = await fetch(origin + "/api/auth", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email, password }) });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(cookie.split("; ").map(s => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: origin, secure: true, sameSite: "Lax" as const }; }));
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  for (const [index, locale] of ["ko", "en", "ja"].entries()) {
    await context.addCookies([{ name: "jmusdt-locale", value: locale, url: origin, secure: true, sameSite: "Lax" }]);
    for (const route of routes) {
      const response = await page.goto(origin + route.path);
      assert.equal(response?.status(), 200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { name: route.headings[index], exact: true })).toBeVisible({ timeout: 30000 });
      if (route.path === "/admin/shop") {
        const card = page.locator(".shop-order").filter({ hasText: ["척척보감", "Cheokcheok Bogam", "チョクチョクボガム"][index] });
        await expect(card).toBeVisible({ timeout: 30000 });
        await card.getByRole("button", { name: ["수정", "Edit", "編集"][index], exact: true }).click();
        await expect(page.getByLabel(["회원가 (실제 결제가 · P)", "Member price (charged amount · P)", "会員価格（実際の支払額 · P）"][index], { exact: true })).toHaveValue("88000.000000");
        await expect(page.getByLabel(["상품명", "Product name", "商品名"][index], { exact: true })).toHaveValue("척척보감");
      }
      results.push({ locale, path: route.path, status: response!.status() });
      console.log(JSON.stringify({ locale, path: route.path, verified: true }));
    }
    await page.goto(origin + "/shop/3140db21-c190-442b-a12e-84f11b3d9734");
    await expect(page.getByRole("heading", { name: ["척척보감", "Cheokcheok Bogam", "チョクチョクボガム"][index], exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".shop-total strong")).toHaveText(["88,000.000000 포인트", "88,000.000000 points", "88,000.000000 ポイント"][index]);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${directory}/product-${locale}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  // The actual selector must update, persist and render the correct language on reload.
  await page.locator(".site-controls select").selectOption("en");
  await page.reload();
  await expect(page.locator(".site-controls select")).toHaveValue("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  assert.deepEqual(errors, []);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM shop_orders WHERE user_id=$1", [userId])).rows[0].n), 0);
  await writeFile(directory + "/verified.json", JSON.stringify({ origin, verifiedAt: new Date().toISOString(), results, locales: ["ko", "en", "ja"], browserErrors: errors, financialTransactionsCreated: 0 }, null, 2));
  console.log(JSON.stringify({ verification: "PASS", routes: results.length, financialTransactionsCreated: 0 }));
} finally {
  await browser?.close();
  if (userId) {
    try { if (cookie) await fetch(origin + "/api/auth", { method: "DELETE", headers: { Origin: origin, Cookie: cookie } }); }
    finally {
      const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: "876000h", app_metadata: { adminConsole: false } });
      if (error) throw new Error("Failed to disable QA account: " + error.code);
      await transaction(async db => {
        await db.query("SELECT pg_advisory_xact_lock(9692027)");
        await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [userId]);
        await db.query("INSERT INTO audit_logs(action,details) VALUES('localization.verification_completed',$1)", [JSON.stringify({ userId, verifiedRoutes: results.length })]);
      });
    }
  }
  await pool.end();
}
