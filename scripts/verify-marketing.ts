import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { database } from "../src/lib/db";
if (!process.argv.includes("--test-account"))
  throw new Error("Explicit --test-account required");
const origin = process.env.APP_ORIGIN!,
  pool = database();
const auth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const users: { id: string; cookie: string }[] = [];
let product: string | undefined;
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
  for (let i = 0; i < 5; i++) {
    const email = `marketing-qa-${randomBytes(8).toString("hex")}@example.com`,
      password = randomBytes(24).toString("base64url");
    const { data, error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: i === 0 ? { adminConsole: true } : {},
    });
    if (error) throw new Error("QA account creation failed: " + error.code);
    const user = { id: data.user.id, cookie: "" };
    users.push(user);
    const login = await call("/api/auth", undefined, {
      action: "login",
      email,
      password,
    });
    assert.equal(login.status, 200);
    user.cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
  }
  const [admin, buyer, ref, sponsor, mom] = users;
  const rls = await pool.query(
    "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('marketing_settings'::regclass,'marketing_rewards'::regclass,'marketing_debts'::regclass)",
  );
  assert.equal(rls.rows.length, 3);
  assert.ok(rls.rows.every((r) => r.relrowsecurity));
  const privileges = await pool.query(
    "SELECT has_table_privilege('authenticated','marketing_rewards','INSERT') AS insert_allowed,has_table_privilege('authenticated','marketing_debts','UPDATE') AS update_allowed,has_function_privilege('authenticated','marketing_run_daily(uuid)','EXECUTE') AS daily_allowed,has_function_privilege('anon','marketing_pay(uuid)','EXECUTE') AS pay_allowed",
  );
  assert.ok(Object.values(privileges.rows[0]).every((v) => v === false));
  assert.equal((await call("/api/rewards")).status, 401);
  assert.equal((await call("/api/admin/marketing", buyer.cookie)).status, 403);
  assert.equal((await call("/api/cron/marketing")).status, 401);
  assert.equal((await call("/api/rewards", buyer.cookie)).status, 200);
  assert.equal(
    (await (await call("/api/rewards", buyer.cookie)).json()).rewards.length,
    0,
  );
  const current = await call("/api/admin/marketing", admin.cookie);
  assert.equal(current.status, 200);
  const settings = (await current.json()).settings;
  const due = await pool.query(
    "SELECT count(*)::int AS n FROM marketing_rewards r JOIN shop_orders o ON o.id=r.order_id WHERE r.status='scheduled' AND o.status='paid' AND r.due_date<=(now() AT TIME ZONE 'Asia/Seoul')::date",
  );
  if (due.rows[0].n === 0) {
    const run = await call("/api/admin/marketing", admin.cookie, {
      action: "daily",
    });
    assert.equal(run.status, 200);
    assert.equal((await run.json()).paid, 0);
    if (process.env.CRON_SECRET) {
      const cron = await fetch(origin + "/api/cron/marketing", {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      assert.equal(cron.status, 200);
      assert.equal((await cron.json()).paid, 0);
      console.log(
        "HTTP: authenticated daily cron and admin replay endpoint PASS (no due rewards)",
      );
    }
  }
  assert.equal(
    (await call("/api/admin/marketing", buyer.cookie, { action: "daily" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("/api/admin/marketing", admin.cookie, {
        action: "settings",
        version: settings.version,
        enabled: settings.enabled,
        dailyPaused: settings.daily_paused,
        reason: "",
      })
    ).status,
    400,
  );
  const plan = {
    referral: "10.000001",
    sponsor: "5",
    mom: "3",
    daily: "2",
    days: 3,
    lucky: 2,
    treasure: 1,
  };
  const draft = {
    name: "Marketing QA product",
    description: "Disposable QA draft",
    imageUrl: "",
    price: "100",
    stock: 10,
    active: false,
    shippingType: "none",
    rewardPlan: plan,
  };
  const created = await call("/api/admin/products", admin.cookie, draft);
  assert.equal(created.status, 200);
  const p = (await created.json()).product;
  product = p.id;
  assert.equal(p.reward_plan.referral, "10000001");
  assert.equal(p.reward_plan.days, 3);
  const stale = await call("/api/shop", buyer.cookie, {
    productId: p.id,
    quantity: 1,
    version: p.version,
    requestKey: crypto.randomUUID(),
    marketingVersion: settings.version + 1,
  });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /마케팅/);
  assert.equal(
    (
      await call("/api/admin/products", admin.cookie, {
        ...draft,
        id: p.id,
        version: p.version,
        rewardPlan: { ...plan, daily: "100" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/api/admin/products", buyer.cookie, draft)).status,
    403,
  );
  assert.equal(
    (await call("/api/admin/marketing?type=invalid", admin.cookie)).status,
    400,
  );
  console.log(
    "HTTP: admin product reward plan save/budget validation, member privacy, admin access and cron authentication PASS",
  );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout=60000");
    // All synthetic funds, rewards, changes and orders below are rolled back.
    await db.query(
      "UPDATE marketing_settings SET enabled=true,daily_paused=false WHERE id=true",
    );
    await db.query(
      "UPDATE member_network SET referrer_id=$1,sponsor_id=$2,position='L' WHERE user_id=$3",
      [ref.id, sponsor.id, buyer.id],
    );
    await db.query(
      "UPDATE member_network SET referrer_id=$1 WHERE user_id=$2",
      [mom.id, sponsor.id],
    );
    await db.query(
      "SELECT wallet_credit_deposit($1,1000000000,'nile',$2,0,1)",
      [buyer.id, "marketing-qa-" + randomBytes(8).toString("hex")],
    );
    await db.query("SELECT wallet_swap($1,'usdt_to_points',1000000000,$2)", [
      buyer.id,
      crypto.randomUUID(),
    ]);
    await db.query("UPDATE shop_products SET active=true WHERE id=$1", [
      product,
    ]);
    const key = crypto.randomUUID(),
      args = [buyer.id, product, 2, p.version, key];
    const id = (
      await db.query("SELECT shop_purchase($1,$2,$3,$4,$5) AS id", args)
    ).rows[0].id;
    assert.equal(
      (await db.query("SELECT shop_purchase($1,$2,$3,$4,$5) AS id", args))
        .rows[0].id,
      id,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1",
          [id],
        )
      ).rows[0].n,
      8,
    );
    assert.equal(
      (
        await db.query(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [ref.id],
        )
      ).rows[0].available,
      "20000002",
    );
    await db.query(
      "UPDATE marketing_rewards SET due_date=(now() AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=$1 AND type='daily' AND installment=1",
      [id],
    );
    assert.equal(
      (await db.query("SELECT marketing_run_daily($1) AS n", [id])).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("SELECT marketing_run_daily($1) AS n", [id])).rows[0].n,
      0,
    );
    await db.query("SELECT wallet_swap($1,'points_to_usdt',20000002,$2)", [
      ref.id,
      crypto.randomUUID(),
    ]);
    await db.query("SELECT shop_refund($1,$2,'Marketing QA rollback-only')", [
      id,
      admin.id,
    ]);
    await db.query("SELECT shop_refund($1,$2,'Marketing QA repeat')", [
      id,
      admin.id,
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [buyer.id],
        )
      ).rows[0].available,
      "1000000000",
    );
    assert.equal(
      (
        await db.query(
          "SELECT outstanding FROM marketing_debts WHERE user_id=$1",
          [ref.id],
        )
      ).rows[0].outstanding,
      "20000002",
    );
    await db.query("SELECT wallet_swap($1,'usdt_to_points',20000002,$2)", [
      ref.id,
      crypto.randomUUID(),
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT outstanding FROM marketing_debts WHERE user_id=$1",
          [ref.id],
        )
      ).rows[0].outstanding,
      "0",
    );
    assert.equal(
      (
        await db.query(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [ref.id],
        )
      ).rows[0].available,
      "0",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) b",
        )
      ).rows[0].n,
      0,
    );
    const accounts = await db.query(
      "SELECT account,sum(units)::text AS amount FROM journal WHERE account IN ('marketing:reserve','marketing:receivable') AND transaction_id IN (SELECT id FROM transactions WHERE user_id=ANY($1::uuid[])) GROUP BY account",
      [users.map((u) => u.id)],
    );
    for (const account of accounts.rows) assert.equal(account.amount, "0");
    console.log(
      "Real PostgreSQL: six rewards, exact quantity/6-decimal amounts, daily schedule/replay, refund/stock restoration, spent-reward debt and incoming-credit recovery PASS (rollback-only)",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
} finally {
  for (const u of users)
    if (u.cookie)
      await fetch(origin + "/api/auth", {
        method: "DELETE",
        headers: { Origin: origin, Cookie: u.cookie },
      });
  if (product)
    await pool.query(
      "DELETE FROM shop_products WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM shop_orders WHERE product_id=$1)",
      [product],
    );
  for (const u of users) {
    await pool.query("DELETE FROM audit_logs WHERE actor=$1", [u.id]);
    await pool.query(
      "DELETE FROM point_balances WHERE user_id=$1 AND available=0",
      [u.id],
    );
    await pool.query(
      "DELETE FROM balances WHERE user_id=$1 AND available=0 AND reserved=0",
      [u.id],
    );
    await pool.query(
      "DELETE FROM profiles WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM transactions WHERE user_id=$1)",
      [u.id],
    );
    const result = await auth.auth.admin.deleteUser(u.id);
    if (result.error) throw new Error("QA cleanup failed");
  }
  await pool.end();
  console.log("Disposable marketing QA accounts and draft product cleaned up");
}
