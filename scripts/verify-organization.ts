import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { database } from "../src/lib/db";
if (!process.argv.includes("--test-account"))
  throw new Error("Explicit --test-account required");
const origin = process.env.APP_ORIGIN!,
  pool = database(),
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
const users: { id: string; cookie: string; code: string }[] = [];
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
async function member(referralCode?: string) {
  const email = `org-qa-${randomBytes(8).toString("hex")}@example.com`,
    password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Organization QA", referral_code: referralCode },
  });
  if (error) throw new Error("QA signup failed: " + error.code);
  const user = { id: data.user.id, cookie: "", code: "" };
  users.push(user);
  const login = await call("/api/auth", undefined, {
    action: "login",
    email,
    password,
  });
  assert.equal(login.status, 200);
  user.cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const tree = await call("/api/organization", user.cookie);
  assert.equal(tree.status, 200);
  user.code = (await tree.json()).code;
  return user;
}
async function qualify(userId:string) {
  const client=await pool.connect();
  try {await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(9692027)");await client.query("UPDATE profiles SET grade_code='vip' WHERE id=$1",[userId]);await client.query("COMMIT");}
  catch(error) {await client.query("ROLLBACK");throw error;}
  finally {client.release();}
}
try {
  assert.equal((await call("/api/organization")).status,401);
  const root=await member(),first=await member(root.code),second=await member(root.code),third=await member(root.code),outside=await member();
  const general=await (await call("/api/organization",root.cookie)).json();
  assert.equal(general.eligible,false);assert.equal(general.nodes.length,0);
  const wallet=await (await call("/api/wallet",root.cookie)).json();
  assert.equal(wallet.referralCode,root.code);
  for(const user of [root,second,first,third,outside]) await qualify(user.id);
  const tree=await (await call("/api/organization",root.cookie)).json();
  assert.equal(tree.nodes.length,3);assert.equal(tree.pending.length,1);
  assert.equal(tree.pending[0].id,third.id);
  assert.ok(!("email" in tree.nodes[0]));assert.ok(!("available" in tree.nodes[0]));
  assert.equal(tree.nodes.find((n:{id:string})=>n.id===second.id).referral_ordinal,"1");
  assert.equal(tree.nodes.find((n:{id:string})=>n.id===first.id).referral_ordinal,"2");
  assert.equal((await call("/api/organization?mode=sponsor&root="+root.id,outside.cookie)).status,403);
  assert.equal((await call("/api/organization",root.cookie,{memberId:first.id,sponsorId:root.id,position:"L"})).status,409);
  const referral=await (await call("/api/organization?mode=referral",root.cookie)).json();
  assert.equal(referral.nodes.length,4);
  assert.equal(referral.nodes.find((n:{id:string})=>n.id===third.id).parent_id,root.id);
  assert.equal((await call("/api/organization?depth=999",root.cookie)).status,400);
  const invalid=await call("/api/auth",undefined,{action:"signup",email:"org-invalid@example.com",password:randomBytes(24).toString("base64url"),referralCode:"000000000000"});
  assert.equal(invalid.status,400);
  console.log("Organization HTTP + DB: general-member invitation, regular qualification order, automatic rollup, missing ancestor waiting, private subtree, manual placement rejection and referral preservation PASS");
} finally {
  for (const user of [...users].reverse()) {
    if (user.cookie)
      await fetch(origin + "/api/auth", {
        method: "DELETE",
        headers: { Origin: origin, Cookie: user.cookie },
      });
    await pool.query("DELETE FROM audit_logs WHERE actor=$1", [user.id]);
    await pool.query(
      "DELETE FROM point_balances WHERE user_id=$1 AND available=0",
      [user.id],
    );
    await pool.query(
      "DELETE FROM balances WHERE user_id=$1 AND available=0 AND reserved=0",
      [user.id],
    );
    await pool.query(
      "DELETE FROM profiles WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM transactions WHERE user_id=$1)",
      [user.id],
    );
    const removed = await admin.auth.admin.deleteUser(user.id);
    if (removed.error) throw new Error("QA cleanup failed");
  }
  await pool.end();
  console.log(
    "Disposable organization QA accounts and relationships cleaned up",
  );
}
