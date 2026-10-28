import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { TronWeb } from "tronweb";
import { database } from "../src/lib/db";
import { MAINNET_USDT } from "../src/lib/tron";
if (!process.argv.includes("--test-account"))
  throw new Error("Explicit --test-account required");
const pool = database(),
  origin = process.env.APP_ORIGIN!,
  auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
const users: { id: string; cookie: string }[] = [];
async function call(
  path: string,
  cookie?: string,
  body?: unknown,
  requestOrigin = origin,
) {
  return fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  for (const role of ["SUPER_ADMIN", "console", "member"]) {
    const email = `sweep-qa-${randomBytes(8).toString("hex")}@example.com`,
      password = randomBytes(24).toString("base64url");
    const { data, error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata:
        role === "SUPER_ADMIN"
          ? { adminRole: "SUPER_ADMIN" }
          : role === "console"
            ? { adminConsole: true }
            : {},
    });
    if (error) throw new Error("QA create failed: " + error.code);
    const u = { id: data.user.id, cookie: "" };
    users.push(u);
    const r = await call("/api/auth", undefined, {
      action: "login",
      email,
      password,
    });
    assert.equal(r.status, 200);
    u.cookie = r.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
  }
  const [superAdmin, consoleAdmin, member] = users;
  assert.equal((await call("/api/admin/sweeps")).status, 401);
  assert.equal((await call("/api/admin/sweeps", member.cookie)).status, 403);
  const response = await call("/api/admin/sweeps", consoleAdmin.cookie);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  console.log(
    "Sweep runtime readiness: " +
      (dashboard.config.issues.join(" · ") || "server configuration present") +
      "; worker " +
      (dashboard.health ? "last heartbeat recorded" : "not connected"),
  );
  assert.equal(dashboard.canExecute, false);
  assert.ok(!JSON.stringify(dashboard).includes("raw_data_hex"));
  assert.ok(!JSON.stringify(dashboard).includes("CUSTODY_TOKEN"));
  assert.equal(
    (await call("/api/admin/sweeps?page=0", consoleAdmin.cookie)).status,
    400,
  );
  const body = {
    action: "settings",
    version: dashboard.settings.version,
    enabled: false,
    maxTopup: "25",
    reserve: "50",
    reason: "QA denied change",
  };
  assert.equal(
    (await call("/api/admin/sweeps", consoleAdmin.cookie, body)).status,
    403,
  );
  const mfa = await call("/api/admin/sweeps", superAdmin.cookie, body);
  assert.equal(mfa.status, 403);
  assert.match((await mfa.json()).error, /2단계/);
  assert.equal(
    (
      await call(
        "/api/admin/sweeps",
        superAdmin.cookie,
        body,
        "https://invalid.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/admin/sweeps", consoleAdmin.cookie, {
        action: "approve",
        reviewId: crypto.randomUUID(),
        token: "0".repeat(64),
        confirmation: "USDT 회수",
        reason: "QA denial",
      })
    ).status,
    403,
  );
  console.log(
    "HTTP: sweep dashboard, no private outbox payload, member denial, console-admin fund denial, SUPER_ADMIN AAL2 and Origin enforcement PASS",
  );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout=30000");
    const cfg = (
      await db.query("SELECT * FROM sweep_settings WHERE id=true FOR UPDATE")
    ).rows[0];
    await db.query("UPDATE sweep_settings SET enabled=true WHERE id=true");
    // Offline fixture addresses, never queried, funded, signed, or broadcast.
    const source = TronWeb.address.fromPrivateKey(
        "3".padStart(64, "0"),
      ) as string,
      company = TronWeb.address.fromPrivateKey("4".padStart(64, "0")) as string;
    await db.query(
      "INSERT INTO deposit_addresses(user_id,address,network) VALUES($1,$2,'nile')",
      [member.id, source],
    );
    const index = (
      await db.query(
        "SELECT derivation_index FROM deposit_addresses WHERE user_id=$1",
        [member.id],
      )
    ).rows[0].derivation_index;
    const r = (
      await db.query(
        "INSERT INTO sweep_reviews(actor,network,contract,company,settings_version,items) VALUES($1,'nile',$2,$3,$4,$5) RETURNING id",
        [
          superAdmin.id,
          MAINNET_USDT,
          company,
          cfg.version,
          JSON.stringify([
            {
              userId: member.id,
              source,
              index,
              amount: "1000001",
              topup: "0",
              feeLimit: "100000000",
            },
          ]),
        ],
      )
    ).rows[0];
    const first = (
      await db.query(
        "SELECT approve_sweep_review($1,$2,'QA rollback-only') AS jobs",
        [r.id, superAdmin.id],
      )
    ).rows[0].jobs;
    assert.equal(first.length, 1);
    assert.deepEqual(
      (
        await db.query(
          "SELECT approve_sweep_review($1,$2,'QA duplicate') AS jobs",
          [r.id, superAdmin.id],
        )
      ).rows[0].jobs,
      first,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM sweep_outbox WHERE job_id=$1",
          [first[0]],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM transactions WHERE user_id=$1",
          [member.id],
        )
      ).rows[0].n,
      0,
    );
    const grants = (
      await db.query(
        "SELECT has_table_privilege('authenticated','sweep_outbox','SELECT') AS read,has_function_privilege('authenticated','approve_sweep_review(uuid,uuid,text)','EXECUTE') AS approve",
      )
    ).rows[0];
    assert.equal(grants.read, false);
    assert.equal(grants.approve, false);
    const rls = await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid IN ('sweep_outbox'::regclass,'sweep_reviews'::regclass,'sweep_settings'::regclass,'sweep_worker_health'::regclass)",
    );
    assert.equal(rls.rows.length, 4);
    assert.ok(rls.rows.every((r) => r.relrowsecurity));
    console.log(
      "Real PostgreSQL: explicit review approval/idempotency, no automatic outbox or ledger mutation, RLS and no browser signing permissions PASS (rollback-only)",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
} finally {
  for (const u of users) {
    if (u.cookie)
      await fetch(origin + "/api/auth", {
        method: "DELETE",
        headers: { Origin: origin, Cookie: u.cookie },
      });
    await pool.query("DELETE FROM audit_logs WHERE actor=$1", [u.id]);
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
  console.log(
    "Disposable sweep QA accounts cleaned up; no chain broadcasts performed",
  );
}
