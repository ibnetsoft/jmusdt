import "./load-env";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {database} from "../src/lib/db";

const project="thxpejttykcdgvjjgwxv";
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,`${project}.supabase.co`);
const files=["member-grades.sql","network-rollup.sql","daily-pools.sql","branding.sql"];
const sql=(await Promise.all(files.map(f=>readFile(new URL("../db/"+f,import.meta.url),"utf8")))).join("\n\n");
const db=database(),client=await db.connect();
try {
  const baseline={
    capturedAt:new Date().toISOString(),project,files,sha256:createHash("sha256").update(sql).digest("hex"),
    counts:(await client.query("SELECT (SELECT count(*)::int FROM profiles) AS profiles,(SELECT count(*)::int FROM shop_orders) AS orders,(SELECT count(*)::int FROM shop_products) AS products,(SELECT count(*)::int FROM marketing_rewards) AS rewards")).rows[0],
    balances:(await client.query("SELECT p.id,p.status,b.available::text,b.reserved::text,coalesce(pb.available,0)::text AS points FROM profiles p LEFT JOIN balances b ON b.user_id=p.id LEFT JOIN point_balances pb ON pb.user_id=p.id ORDER BY p.id")).rows,
    ledger:(await client.query("SELECT account,asset,sum(units)::text AS units FROM journal GROUP BY account,asset ORDER BY account,asset")).rows,
    functions:(await client.query("SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname",[["organization_signup","network_place","marketing_purchase_rewards","marketing_pay","marketing_run_daily","marketing_plan_valid"]])).rows,
    network:(await client.query("SELECT * FROM member_network ORDER BY user_id")).rows,
  };
  await mkdir("artifacts/release",{recursive:true});
  await writeFile("artifacts/release/baseline.json",JSON.stringify(baseline,null,2));
  await writeFile("artifacts/release/migration.sql",sql);
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(9692027)");
  await client.query(sql);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM member_grades WHERE code IN ('general','vip')")).rows[0].n,2);
  assert.equal((await client.query("SELECT has_function_privilege('authenticated','network_activate(uuid)','EXECUTE') AS allowed")).rows[0].allowed,false);
  await client.query("ROLLBACK");
  console.log(JSON.stringify({project,counts:baseline.counts,migrationHash:baseline.sha256,transactionalMigrationDryRun:"PASS",snapshot:"artifacts/release/baseline.json"}));
} catch(error) {await client.query("ROLLBACK");throw error;}
finally {client.release();await db.end();}
