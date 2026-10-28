import "./load-env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect, type Browser } from "@playwright/test";
import { database, transaction } from "../src/lib/db";

// Explicit production QA. Uses only this run's identities, auditable POINT funding,
// real catalog/checkout/refund APIs, and a ROLLBACK for the midnight preview.
assert.ok(process.argv.includes("--execute-qa"), "Explicit --execute-qa required");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname, "thxpejttykcdgvjjgwxv.supabase.co");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "aws-0-ap-northeast-2.pooler.supabase.com");
assert.ok(decodeURIComponent(url.username).endsWith(".thxpejttykcdgvjjgwxv"));
url.port = "6543";
process.env.DATABASE_URL = url.toString();
const origin = "https://jmusdt.com", pool = database(), unit = 1_000_000n;
const run = "referral-" + randomBytes(6).toString("hex"), dir = `artifacts/referral/${run}`;
const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const catalog = { goods: "3140db21-c190-442b-a12e-84f11b3d9734", lucky: "94d0df30-036a-4dd4-b171-dd44c968a223", treasure: "2c059891-9b58-48f6-9b74-0d15a0cd7d6f" };
type Member = { id: string; role: string; email: string; code: string; parent: string | null; cookie: string; seed: bigint };
const users: Member[] = [], orders: string[] = [], checks: string[] = [];
const evidence: Record<string, unknown> = {};
let browser: Browser | undefined, success = false, cleanupSucceeded = false;
let baseline: { members: unknown[]; ledger: unknown[]; products: Record<string, unknown>[] } | undefined;
await mkdir(dir, { recursive: true });
async function save() {
  await writeFile(`${dir}/verified.json`, JSON.stringify({ run, origin, updatedAt: new Date().toISOString(), success, cleanupSucceeded, users: users.map(({ cookie: _cookie, seed, ...u }) => ({ ...u, seed: seed.toString() })), orders, checks, evidence }, null, 2));
}
async function pass(message: string) { checks.push(message); console.log("PASS " + message); await save(); }
async function call(path: string, user?: Member, body?: unknown, method?: string, status = 200) {
  const response = await fetch(origin + path, { method: method || (body ? "POST" : "GET"), headers: { Origin: origin, ...(user ? { Cookie: user.cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
  const data = await response.json();
  assert.equal(response.status, status, `${path}: HTTP ${response.status}: ${data.error || "unexpected response"}`);
  return data;
}
async function member(role: string, parent?: Member, admin = false) {
  const email = `${run}-${role}@example.com`, password = randomBytes(30).toString("base64url");
  const { data, error } = await auth.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: `QA ${role} ${run}`, ...(parent ? { referral_code: parent.code } : {}) }, app_metadata: { adminConsole: admin } });
  if (error) throw new Error("QA user creation failed: " + error.code);
  const user: Member = { id: data.user.id, role, email, code: "", parent: parent?.id || null, cookie: "", seed: 0n };
  users.push(user); await save();
  const network = (await pool.query("SELECT referral_code,referrer_id FROM member_network WHERE user_id=$1", [user.id])).rows[0];
  user.code = network.referral_code;
  assert.match(user.code, /^[A-F0-9]{12}$/);
  assert.equal(network.referrer_id, user.parent);
  const response = await fetch(origin + "/api/auth", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email, password }), signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200, "QA login failed for " + role);
  user.cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  assert.ok(user.cookie, "Login session missing");
  await save(); console.log("CREATED " + role);
  return user;
}
async function qualify(user: Member, admin: Member) {
  await call("/api/admin/grades", admin, { action: "assign", userId: user.id, gradeCode: "vip", reason: `QA ${run}: manual regular membership` });
}
async function seed(user: Member, points: bigint) {
  const amount = points * unit;
  await transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(9692027)");
    assert.equal((await db.query("SELECT coalesce((SELECT available FROM point_balances WHERE user_id=$1),0)::text AS n", [user.id])).rows[0].n, "0");
    const tx = (await db.query("INSERT INTO transactions(user_id,kind,amount,status,asset,note) VALUES($1,'reward',$2,'completed','POINT',$3) RETURNING id", [user.id, amount.toString(), `QA ${run}: temporary POINT funding; no on-chain deposit`])).rows[0].id;
    await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET available=point_balances.available+EXCLUDED.available", [user.id, amount.toString()]);
    await db.query("INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES($1,$2,$3,$4,'POINT'),($1,$2,$5,$6,'POINT')", [tx, randomUUID(), `qa:${run}:funding`, (-amount).toString(), user.id + ":available", amount.toString()]);
    await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'qa.referral_seed',$2)", [user.id, JSON.stringify({ run, amount: amount.toString() })]);
  });
  user.seed = amount; await save();
}
const shipping = { recipient: "QA 검증 — 실물 발송 금지", phone: "000-0000-0000", address: "운영 통합검증용 가상 주소 — 실물 발송 금지", note: "자동 환불 예정인 테스트 주문입니다. 배송하지 마세요." };
async function orderBody(productId: string, quantity: number) {
  const product = (await pool.query("SELECT version,shipping_type FROM shop_products WHERE id=$1", [productId])).rows[0];
  const settings = (await pool.query("SELECT version FROM marketing_settings WHERE id=true")).rows[0];
  const { rows } = await pool.query("SELECT extract(epoch FROM ((((now() AT TIME ZONE 'Asia/Seoul')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul')-now()))::int AS remaining");
  assert.ok(rows[0].remaining > 600, "Do not run production purchases close to midnight; cleanup must precede the cron");
  return { productId, quantity, version: product.version, marketingVersion: settings.version, requestKey: randomUUID(), ...(product.shipping_type === "physical" ? { shipping } : {}) };
}
async function buy(user: Member, productId: string, quantity: number) {
  const body = await orderBody(productId, quantity);
  const bought = await call("/api/shop", user, body);
  orders.push(bought.id); await save();
  const replay = await Promise.all([call("/api/shop", user, body), call("/api/shop", user, body)]);
  assert.ok(replay.every(r => r.id === bought.id), "Concurrent retries must return the original order");
  return bought.id as string;
}
async function contextFor(user: Member) {
  const context = await browser!.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(user.cookie.split("; ").map(s => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: origin, secure: true, sameSite: "Lax" as const }; }));
  return context;
}
async function refund(user: Member, orderId: string, admin: Member) {
  await call("/api/orders/cancel", user, { orderId, reason: `QA ${run}: refund and restore stock; no physical fulfillment` });
  return call("/api/admin/orders", admin, { orderId, action: "approve", reason: `QA ${run}: verified reward reversal and test cleanup` });
}
async function cleanup() {
  // Scope every write to recorded QA IDs. Retain financial/audit history.
  const ids = users.map(u => u.id);
  if (!ids.length) return;
  try {
    await transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(9692027)");
      const pending = await db.query("SELECT id FROM shop_orders WHERE user_id=ANY($1::uuid[]) AND status<>'cancelled' ORDER BY created_at DESC", [ids]);
      for (const row of pending.rows) await db.query("SELECT shop_refund($1,$2,$3)", [row.id, users[0].id, `QA ${run}: guaranteed cleanup`]);
      for (const user of users) {
        const value = BigInt((await db.query("SELECT coalesce((SELECT available FROM point_balances WHERE user_id=$1),0)::text AS n", [user.id])).rows[0].n);
        assert.equal(value, user.seed, "After refunds QA balance must equal its temporary funding: " + user.role);
        if (value > 0n) {
          const tx = (await db.query("INSERT INTO transactions(user_id,kind,amount,status,asset,note) VALUES($1,'reward_reversal',$2,'completed','POINT',$3) RETURNING id", [user.id, value.toString(), `QA ${run}: reverse temporary POINT funding`])).rows[0].id;
          await db.query("UPDATE point_balances SET available=0 WHERE user_id=$1", [user.id]);
          await db.query("INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES($1,$2,$3,$4,'POINT'),($1,$2,$5,$6,'POINT')", [tx, randomUUID(), user.id + ":available", (-value).toString(), `qa:${run}:funding`, value.toString()]);
        }
        await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [user.id]);
      }
      await db.query("INSERT INTO audit_logs(action,details) VALUES('qa.referral_cleanup',$1)", [JSON.stringify({ run, users: ids, orders })]);
    });
  } finally {
    // Disable all auth identities even if a financial assertion requires inspection.
    const failures: string[] = [];
    for (const user of users) {
      try {
        if (user.cookie) await call("/api/auth", user, undefined, "DELETE");
      } catch { failures.push("logout " + user.role); }
      const { error } = await auth.auth.admin.updateUserById(user.id, { ban_duration: "876000h", app_metadata: { adminConsole: false } });
      if (error) failures.push("disable " + user.role);
      await pool.query("UPDATE profiles SET status='blocked' WHERE id=$1", [user.id]);
    }
    assert.deepEqual(failures, [], "QA auth cleanup failed");
  }
  const state = (await pool.query("SELECT (SELECT count(*) FROM auth.sessions WHERE user_id=ANY($1::uuid[]))::int AS sessions,(SELECT count(*) FROM profiles WHERE id=ANY($1::uuid[]) AND status<>'blocked')::int AS active,(SELECT coalesce(sum(available),0)::text FROM point_balances WHERE user_id=ANY($1::uuid[])) AS balance,(SELECT coalesce(sum(outstanding),0)::text FROM marketing_debts WHERE user_id=ANY($1::uuid[])) AS debt,(SELECT count(*) FROM shop_orders WHERE user_id=ANY($1::uuid[]) AND status<>'cancelled')::int AS orders,(SELECT coalesce(sum(units),0)::text FROM journal WHERE account=$2) AS funding", [ids, `qa:${run}:funding`])).rows[0];
  assert.deepEqual(state, { sessions: 0, active: 0, balance: "0", debt: "0", orders: 0, funding: "0" });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) q")).rows[0].n, 0);
  if (baseline) {
    const after = (await pool.query("SELECT p.id,p.status,b.available::text,b.reserved::text,coalesce(pb.available,0)::text AS points FROM profiles p LEFT JOIN balances b ON b.user_id=p.id LEFT JOIN point_balances pb ON pb.user_id=p.id WHERE NOT p.id=ANY($1::uuid[]) ORDER BY p.id", [ids])).rows;
    assert.deepEqual(after, baseline.members, "Existing member balances/status changed");
    const ledger = (await pool.query("SELECT account,asset,sum(units)::text AS units FROM journal GROUP BY account,asset HAVING sum(units)<>0 ORDER BY account,asset")).rows;
    assert.deepEqual(ledger, baseline.ledger, "Accounting failed to return to baseline");
    const products = (await pool.query("SELECT id,name,price::text,retail_price::text,stock,active,shipping_type,package_type,reward_plan FROM shop_products WHERE id=ANY($1::uuid[]) ORDER BY id", [Object.values(catalog)])).rows;
    assert.deepEqual(products, baseline.products, "Product stock/prices/configuration changed");
  }
  cleanupSucceeded = true; evidence.cleanup = state;
  await pass("All test orders refunded; POINT funding/rewards restored; stocks/configuration and existing members unchanged; QA sessions revoked and accounts blocked");
}

try {
  assert.equal((await pool.query("SELECT enabled AND NOT daily_paused AS ready FROM marketing_settings WHERE id=true")).rows[0].ready, true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM shop_orders WHERE status<>'cancelled'")).rows[0].n, 0, "This deterministic QA requires no live orders; do not alter another member's orders");
  baseline = {
    members: (await pool.query("SELECT p.id,p.status,b.available::text,b.reserved::text,coalesce(pb.available,0)::text AS points FROM profiles p LEFT JOIN balances b ON b.user_id=p.id LEFT JOIN point_balances pb ON pb.user_id=p.id ORDER BY p.id")).rows,
    ledger: (await pool.query("SELECT account,asset,sum(units)::text AS units FROM journal GROUP BY account,asset HAVING sum(units)<>0 ORDER BY account,asset")).rows,
    products: (await pool.query("SELECT id,name,price::text,retail_price::text,stock,active,shipping_type,package_type,reward_plan FROM shop_products WHERE id=ANY($1::uuid[]) ORDER BY id", [Object.values(catalog)])).rows,
  };
  assert.equal(baseline.products.length, 3);
  assert.ok(baseline.products.every(p => p.active));
  await pass("Production project and active official catalog verified; no live orders or packages present");
  const ancestors: Member[] = [];
  for (const role of ["A", "B", "C", "D"]) {
    const user = await member(role, ancestors.at(-1), role === "A");
    ancestors.push(user); await qualify(user, ancestors[0]);
  }
  const admin = ancestors[0], referrer = ancestors[3];
  const buyers = new Map<number, Member>();
  // Signup in reverse order to prove placement follows qualification, not signup.
  for (let n = 12; n >= 1; n--) buyers.set(n, await member("buyer" + n, referrer));
  assert.equal(new Set(users.map(u => u.code)).size, 16);
  assert.equal((await call("/api/organization", buyers.get(12))).eligible, false);
  await pass("16 confirmed QA accounts created with unique referral codes; A → B → C → D → 12 buyers; general membership restricted before qualifying purchase");

  browser = await chromium.launch({ headless: true });
  const referralContext = await contextFor(referrer), referralPage = await referralContext.newPage();
  await referralContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await referralPage.goto(origin + "/mypage");
  await expect(referralPage.getByLabel("추천 가입 링크")).toHaveValue(origin + "/login?ref=" + referrer.code, { timeout: 30000 });
  await referralPage.getByRole("button", { name: "추천링크 복사", exact: true }).click();
  assert.equal(await referralPage.evaluate(() => navigator.clipboard.readText()), origin + "/login?ref=" + referrer.code);
  await referralPage.screenshot({ path: `${dir}/referral-link.png`, fullPage: true });
  const anonymous = await browser.newContext(), signup = await anonymous.newPage();
  await signup.goto(origin + "/login?ref=" + referrer.code);
  await expect(signup.getByLabel("추천 코드 (선택)")).toHaveValue(referrer.code);
  await anonymous.close();
  await pass("Actual mypage referral copy button and anonymous signup referral prefill verified in production browser (no email sent)");

  const first = buyers.get(1)!, invalid = await orderBody(catalog.goods, 1);
  const { shipping: _shipping, ...withoutShipping } = invalid;
  await call("/api/shop", first, withoutShipping, undefined, 400);
  await call("/api/shop", first, invalid, undefined, 409);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM shop_orders WHERE user_id=$1", [first.id])).rows[0].n, 0);
  for (const [n, buyer] of buyers) await seed(buyer, n === 1 ? 5_000_000n : n === 2 ? 10_000_000n : 200_000n);
  await pass("Missing shipping and insufficient points rejected without orders; auditable temporary test funding recorded");

  const results: Record<string, unknown>[] = [];
  const goodsOrders: string[] = [];
  for (let n = 1; n <= 12; n++) {
    const buyer = buyers.get(n)!, quantity = n === 3 ? 2 : 1;
    let id: string;
    if (n === 1) {
      const context = await contextFor(buyer), page = await context.newPage();
      await page.goto(origin + "/shop/" + catalog.goods);
      await expect(page.getByRole("heading", { name: "척척보감", exact: true })).toBeVisible({ timeout: 30000 });
      for (const [label, value] of [["받는 분", shipping.recipient], ["연락처", shipping.phone], ["배송 주소", shipping.address], ["배송 요청사항 (선택)", shipping.note]]) await page.getByLabel(label, { exact: true }).fill(value);
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/api/shop" && r.request().method() === "POST");
      await page.getByRole("button", { name: "88,000.000000 포인트 결제 확정", exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 200, "Production browser checkout failed");
      id = (await response.json()).id;
      orders.push(id); await save();
      await expect(page.locator(".shop-success")).toContainText("구매가 완료되었습니다");
      await page.screenshot({ path: `${dir}/purchase.png`, fullPage: true });
      await context.close();
    } else id = await buy(buyer, catalog.goods, quantity);
    goodsOrders.push(id);
    const row = (await pool.query("SELECT o.total::text,o.quantity,o.reward_snapshot,n.referral_ordinal::text,n.rollup_generation,n.sponsor_id,n.placement_reason,p.grade_code FROM shop_orders o JOIN member_network n ON n.user_id=o.user_id JOIN profiles p ON p.id=o.user_id WHERE o.id=$1", [id])).rows[0];
    const generation = n % 3 === 0 ? n / 3 : 0, sponsor = ancestors[3 - generation] || null;
    const mom = sponsor ? ancestors[2 - generation] || null : null;
    assert.equal(row.grade_code, "vip"); assert.equal(row.referral_ordinal, String(n)); assert.equal(row.rollup_generation, generation);
    assert.equal(row.sponsor_id, sponsor?.id || null);
    assert.equal(row.reward_snapshot.referral, referrer.id); assert.equal(row.reward_snapshot.sponsor, sponsor?.id || null); assert.equal(row.reward_snapshot.mom, mom?.id || null);
    assert.equal(row.total, (88_000n * BigInt(quantity) * unit).toString());
    if (n === 12) assert.match(row.placement_reason, /상위 추천인 없음/);
    const rewards = (await pool.query("SELECT r.type,r.user_id,r.status,r.amount::text,t.asset FROM marketing_rewards r LEFT JOIN transactions t ON t.id=r.transaction_id WHERE r.order_id=$1 ORDER BY r.type", [id])).rows;
    const expected = [
      { type: "mom", user_id: mom?.id || null, status: mom ? "paid" : "skipped", amount: (4500n * BigInt(quantity) * unit).toString(), asset: mom ? "POINT" : null },
      { type: "referral", user_id: referrer.id, status: "paid", amount: (9000n * BigInt(quantity) * unit).toString(), asset: "POINT" },
      { type: "sponsor", user_id: sponsor?.id || null, status: sponsor ? "paid" : "skipped", amount: (4500n * BigInt(quantity) * unit).toString(), asset: sponsor ? "POINT" : null },
    ];
    assert.deepEqual(rewards, expected);
    const entries = (await pool.query("SELECT kind,amount::text,cutoff=(((o.created_at AT TIME ZONE 'Asia/Seoul')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul') AS correct_cutoff FROM daily_pool_entries e JOIN shop_orders o ON o.id=e.order_id WHERE o.id=$1 ORDER BY kind", [id])).rows;
    assert.deepEqual(entries, ["lucky", "treasure"].map(kind => ({ kind, amount: (3000n * BigInt(quantity) * unit).toString(), correct_cutoff: true })));
    results.push({ buyer: buyer.role, order: id, quantity, chargedP: 88000 * quantity, ordinal: n, sponsor: sponsor?.role || null, mom: mom?.role || null, rewards });
    console.log(`VERIFIED buyer${n}: referral D, sponsor ${sponsor?.role || "waiting"}, mom ${mom?.role || "none"}, quantity ${quantity}`);
    await save();
  }
  evidence.purchases = results;
  evidence.immediateTotals = (await pool.query("SELECT type,status,sum(amount)::text AS amount,count(*)::int AS count FROM marketing_rewards WHERE order_id=ANY($1::uuid[]) GROUP BY type,status ORDER BY type,status", [goodsOrders])).rows;
  const immediate = (await pool.query("SELECT type,sum(amount)::text AS amount FROM marketing_rewards WHERE order_id=ANY($1::uuid[]) AND status='paid' GROUP BY type ORDER BY type", [goodsOrders])).rows;
  assert.deepEqual(immediate, [{ type: "mom", amount: "49500000000" }, { type: "referral", amount: "117000000000" }, { type: "sponsor", amount: "54000000000" }]);
  await pass("12 official goods purchases (13 units): 117,000 P referral + 54,000 P sponsor + 49,500 P mom paid immediately; 3/6/9 rollups and 12th missing ancestor correct; concurrent retries did not duplicate rewards");

  const packageOrders: { id: string; buyer: Member; quantity: number; kind: "lucky" | "treasure" }[] = [];
  for (const kind of ["lucky", "treasure"] as const) for (const n of [1, 2]) {
    const buyer = buyers.get(n)!, id = await buy(buyer, catalog[kind], n);
    packageOrders.push({ id, buyer, quantity: n, kind });
    const rows = (await pool.query("SELECT type,status,count(*)::int AS n,min(amount)::text AS amount,min(due_date)::text AS first_due,max(due_date)::text AS last_due FROM marketing_rewards WHERE order_id=$1 GROUP BY type,status", [id])).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].type, "daily"); assert.equal(rows[0].status, "scheduled"); assert.equal(rows[0].n, 369);
    assert.equal(rows[0].amount, (BigInt(kind === "lucky" ? 1000 : 10000) * BigInt(n) * unit).toString());
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM daily_pool_entries WHERE order_id=$1", [id])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT min(due_date)=(o.created_at AT TIME ZONE 'Asia/Seoul')::date+1 AS correct FROM marketing_rewards r JOIN shop_orders o ON o.id=r.order_id WHERE o.id=$1 GROUP BY o.created_at", [id])).rows[0].correct, true);
  }
  for (const n of [1, 2]) {
    const data = await call("/api/rewards", buyers.get(n));
    assert.deepEqual(data.packages.sort((a: { package_type: string }, b: { package_type: string }) => a.package_type.localeCompare(b.package_type)), [{ package_type: "lucky", quantity: String(n) }, { package_type: "treasure", quantity: String(n) }]);
  }
  await pass("Official 350,000/3,500,000 P packages bought in 1:2 quantities; only 369 daily installments scheduled, no purchase referral/sponsor/mom/company contributions");

  // Run the actual DB payout functions under one transaction and roll everything
  // back, so no global cron or other member's holdings/balances are modified.
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(9692027)");
    const cutoff = (await db.query("SELECT ((d::date)::timestamp AT TIME ZONE 'Asia/Seoul')::text AS cutoff FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date-30,(now() AT TIME ZONE 'Asia/Seoul')::date-1,interval '1 day') d WHERE NOT EXISTS(SELECT 1 FROM daily_pool_runs r WHERE r.cutoff=(d::date)::timestamp AT TIME ZONE 'Asia/Seoul') AND NOT EXISTS(SELECT 1 FROM daily_pool_entries e WHERE e.cutoff=(d::date)::timestamp AT TIME ZONE 'Asia/Seoul') ORDER BY d DESC LIMIT 1")).rows[0]?.cutoff;
    assert.ok(cutoff, "Unused historical midnight cutoff required");
    const ids = users.map(u => u.id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM shop_orders WHERE status<>'cancelled' AND NOT user_id=ANY($1::uuid[])", [ids])).rows[0].n, 0, "A live member ordered during QA: do not simulate global pools");
    await db.query("UPDATE shop_orders SET created_at=$2::timestamptz-interval '12 hours' WHERE id=ANY($1::uuid[])", [orders, cutoff]);
    await db.query("UPDATE member_network SET activated_at=$2::timestamptz-interval '2 days' WHERE user_id=ANY($1::uuid[])", [ids, cutoff]);
    await db.query("UPDATE daily_pool_entries SET cutoff=$2 WHERE order_id=ANY($1::uuid[])", [goodsOrders, cutoff]);
    await db.query("UPDATE marketing_rewards SET due_date=($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=ANY($1::uuid[]) AND type='daily' AND installment=1", [packageOrders.map(o => o.id), cutoff]);
    let daily = 0;
    for (const order of packageOrders) daily += (await db.query("SELECT marketing_run_daily($1) AS n", [order.id])).rows[0].n;
    assert.equal(daily, 4);
    for (const kind of ["lucky", "treasure"]) await db.query("SELECT daily_pool_settle($1,$2)", [kind, cutoff]);
    const runs = (await db.query("SELECT kind,total::text,distributed::text,retained::text,package_count::text FROM daily_pool_runs WHERE cutoff=$1 ORDER BY kind", [cutoff])).rows;
    assert.deepEqual(runs, ["lucky", "treasure"].map(kind => ({ kind, total: "39000000000", distributed: "39000000000", retained: "0", package_count: "3" })));
    const payments = (await db.query("SELECT r.kind,p.user_id,p.quantity::text,p.amount::text FROM daily_pool_payments p JOIN daily_pool_runs r ON r.id=p.run_id WHERE r.cutoff=$1 ORDER BY r.kind,p.quantity", [cutoff])).rows;
    assert.deepEqual(payments, ["lucky", "treasure"].flatMap(kind => [1, 2].map(n => ({ kind, user_id: buyers.get(n)!.id, quantity: String(n), amount: (13000n * BigInt(n) * unit).toString() }))));
    const firstDaily = (await db.query("SELECT order_id,amount::text FROM marketing_rewards WHERE order_id=ANY($1::uuid[]) AND type='daily' AND status='paid' ORDER BY order_id", [packageOrders.map(o => o.id)])).rows;
    for (const order of packageOrders) assert.equal(firstDaily.find(r => r.order_id === order.id)?.amount, (BigInt(order.kind === "lucky" ? 1000 : 10000) * BigInt(order.quantity) * unit).toString());
    for (const order of packageOrders) assert.equal((await db.query("SELECT marketing_run_daily($1) AS n", [order.id])).rows[0].n, 0);
    for (const kind of ["lucky", "treasure"]) await db.query("SELECT daily_pool_settle($1,$2)", [kind, cutoff]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM daily_pool_payments p JOIN daily_pool_runs r ON r.id=p.run_id WHERE r.cutoff=$1", [cutoff])).rows[0].n, 4);
    evidence.midnightPreview = { cutoff, mode: "actual production DB functions inside ROLLBACK", actualWallClockMidnightObserved: false, dailyInstallmentsPaid: daily, firstDaily, runs, payments, replayPayments: 0 };
  } finally { await db.query("ROLLBACK"); db.release(); }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=ANY($1::uuid[]) AND type='daily' AND status='paid'", [orders])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM daily_pool_entries WHERE order_id=ANY($1::uuid[]) AND settled_at IS NOT NULL", [orders])).rows[0].n, 0);
  await pass("Midnight preview rolled back: each 39,000 P company pool split 13,000/26,000 P by 1:2 holdings; first daily payouts 1,000/2,000/10,000/20,000 P; rerun pays nothing twice");

  const org = await call("/api/organization?mode=referral&depth=3", referrer);
  assert.equal(org.nodes.length, 13);
  const sponsorTree = await call("/api/organization?mode=sponsor&depth=3", referrer);
  assert.equal(sponsorTree.pending.length, 1); assert.equal(sponsorTree.pending[0].id, buyers.get(12)!.id);
  const errors: string[] = [];
  referralPage.on("pageerror", e => errors.push(e.message));
  await referralPage.goto(origin + "/organization");
  await expect(referralPage.getByText("자동 배치 대기 (1)")).toBeVisible({ timeout: 30000 });
  await referralPage.screenshot({ path: `${dir}/sponsor-tree.png`, fullPage: true });
  await referralPage.goto(origin + "/rewards");
  await expect(referralPage.getByRole("heading", { name: "나의 리워드", exact: true })).toBeVisible();
  await expect(referralPage.locator(".shop-order").first()).toBeVisible({ timeout: 30000 });
  await referralPage.screenshot({ path: `${dir}/rewards.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await referralContext.close();
  await pass("Production referral/sponsor organization APIs, waiting placement and actual reward history UI verified");

  for (const id of [...orders].reverse()) {
    const owner = (await pool.query("SELECT user_id FROM shop_orders WHERE id=$1", [id])).rows[0].user_id;
    const result = await refund(users.find(u => u.id === owner)!, id, admin);
    assert.equal((await call("/api/admin/orders", admin, { orderId: id, action: "approve", reason: `QA ${run}: idempotent refund replay` })).transactionId, result.transactionId);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=ANY($1::uuid[]) AND status IN ('scheduled','paid')", [orders])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM daily_pool_entries WHERE order_id=ANY($1::uuid[]) AND cancelled_at IS NULL", [orders])).rows[0].n, 0);
  for (const n of [1, 2]) assert.deepEqual((await call("/api/rewards", buyers.get(n))).packages, []);
  await pass("16 production cancellation/refund flows verified; direct rewards reversed, 1,476 future daily rights voided, company contributions and package eligibility removed, refund replay idempotent");
  success = true;
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : "Unknown failure";
  throw error;
} finally {
  await browser?.close();
  try { await cleanup(); }
  catch (error) { success = false; evidence.cleanupFailure = error instanceof Error ? error.message : "Unknown cleanup failure"; throw error; }
  finally { await save(); await pool.end(); console.log("Evidence: " + dir + "/verified.json"); }
}
