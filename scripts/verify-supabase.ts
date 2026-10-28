import "./load-env";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { database, transaction } from "../src/lib/db";

// Creates only a unique, disposable QA identity. Never prints passwords, links,
// JWTs, cookies or project credentials. Requires an explicit opt-in to run.
if (!process.argv.includes("--test-account"))
  throw new Error(
    "Pass --test-account to create and clean up a disposable QA user",
  );
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origin = process.env.APP_ORIGIN!;
const password = randomBytes(24).toString("base64url") + "aA1!";
const email = `jmusdt-qa-${randomBytes(8).toString("hex")}@example.com`;
const pool = database();
let userId: string | undefined;
let accessToken: string | undefined;
function sessionCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .filter(
      (cookie) =>
        !cookie.startsWith(
          "sb-" +
            new URL(url).hostname.split(".")[0] +
            "-auth-token-code-verifier=",
        ),
    )
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
async function postAuth(body: unknown, cookie?: string) {
  return fetch(origin + "/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
try {
  assert.equal((await pool.query("SELECT 1 AS ok")).rows[0].ok, 1);
  console.log("TLS-verified database query: PASS");
  // This provider signup creates the same email/password identity and a real
  // confirmation token without sending mail or disabling email verification.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { data: { name: "JMUSDT QA" } },
  });
  if (error) throw new Error("QA signup generation failed: " + error.code);
  userId = data.user.id;
  assert.ok(!data.user.email_confirmed_at);
  console.log("Provider signup (confirmation pending, no email sent): PASS");
  const before = await postAuth({ action: "login", email, password });
  assert.equal(before.status, 400);
  console.log("Unconfirmed account login denied: PASS");
  const landing = await fetch(
    origin +
      "/auth/confirm?" +
      new URLSearchParams({
        token_hash: data.properties.hashed_token,
        type: "signup",
      }),
    { redirect: "manual" },
  );
  assert.equal(landing.status, 200);
  assert.equal(
    (await admin.auth.admin.getUserById(userId)).data.user?.email_confirmed_at,
    undefined,
  );
  const confirmed = await fetch(origin + "/auth/confirm", {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      token_hash: data.properties.hashed_token,
      type: "signup",
    }),
  });
  assert.equal(confirmed.status, 303);
  assert.equal(new URL(confirmed.headers.get("location")!).pathname, "/login");
  const confirmCookie = sessionCookies(confirmed);
  assert.ok(confirmCookie);
  const wallet = await fetch(origin + "/api/wallet", {
    headers: { Cookie: confirmCookie },
  });
  assert.equal(wallet.status, 200);
  const snapshot = await wallet.json();
  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.user.id, userId);
  assert.equal(snapshot.available, "0");
  assert.equal(snapshot.address, null);
  console.log(
    "Confirmation callback -> authenticated wallet and DB profile: PASS",
  );
  const login = await postAuth({ action: "login", email, password });
  assert.equal(login.status, 200);
  const cookie = sessionCookies(login);
  assert.ok(cookie);
  const authenticated = await fetch(origin + "/api/wallet", {
    headers: { Cookie: cookie },
  });
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).user.id, userId);
  console.log("Password login -> cookie session -> wallet API: PASS");
  const consoleAccess = await fetch(origin + "/api/admin", {
    headers: { Cookie: cookie },
  });
  assert.equal(consoleAccess.status, 403);
  console.log("Ordinary member administrator access denied: PASS");
  const noTicket = await fetch(origin + "/api/auth/password", {
    headers: { Cookie: cookie },
  });
  assert.equal(noTicket.status, 403);
  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  assert.equal(recovery.error, null);
  const recoveryForm = new URLSearchParams({
    token_hash: recovery.data.properties!.hashed_token,
    type: "recovery",
  });
  const recoveryLanding = await fetch(
    origin + "/auth/confirm?" + recoveryForm,
    { redirect: "manual" },
  );
  assert.equal(recoveryLanding.status, 200);
  const redeem = await fetch(origin + "/auth/confirm", {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: recoveryForm,
  });
  assert.equal(redeem.status, 303);
  assert.equal(
    new URL(redeem.headers.get("location")!).pathname,
    "/reset-password",
  );
  const recoveryCookies = sessionCookies(redeem);
  assert.match(recoveryCookies, /jmusdt_password_recovery=/);
  assert.equal(
    (
      await fetch(origin + "/api/auth/password", {
        headers: { Cookie: recoveryCookies },
      })
    ).status,
    200,
  );
  const ticketOnly = recoveryCookies
    .split("; ")
    .filter((v) => v.startsWith("jmusdt_password_recovery="))
    .join("; ");
  assert.equal(
    (
      await fetch(origin + "/api/auth/password", {
        headers: { Cookie: cookie + "; " + ticketOnly },
      })
    ).status,
    403,
  );
  await pool.query(
    "UPDATE password_recovery_grants SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [userId],
  );
  assert.equal(
    (
      await fetch(origin + "/api/auth/password", {
        headers: { Cookie: recoveryCookies },
      })
    ).status,
    403,
  );
  await pool.query(
    "UPDATE password_recovery_grants SET expires_at=now()+interval '15 minutes' WHERE user_id=$1",
    [userId],
  );
  assert.equal(
    (
      await fetch(origin + "/api/auth/password", {
        method: "POST",
        headers: {
          Origin: "https://invalid.example",
          "Content-Type": "application/json",
          Cookie: recoveryCookies,
        },
        body: JSON.stringify({ password: "invalid", confirmation: "invalid" }),
      })
    ).status,
    403,
  );
  const hidden = await client.from("password_recovery_grants").select("*");
  assert.ok(hidden.error);
  const newPassword = randomBytes(24).toString("base64url") + "aA1!";
  const update = () =>
    fetch(origin + "/api/auth/password", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: recoveryCookies,
      },
      body: JSON.stringify({
        password: newPassword,
        confirmation: newPassword,
      }),
    });
  const changed = await update();
  assert.equal(changed.status, 200);
  assert.equal((await update()).status, 403);
  assert.equal(
    (await fetch(origin + "/api/wallet", { headers: { Cookie: cookie } }))
      .status,
    401,
  );
  assert.equal(
    (await postAuth({ action: "login", email, password })).status,
    400,
  );
  assert.equal(
    (await postAuth({ action: "login", email, password: newPassword })).status,
    200,
  );
  const replay = await fetch(origin + "/auth/confirm", {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: recoveryForm,
  });
  assert.equal(
    new URL(replay.headers.get("location")!).searchParams.get("error"),
    "confirmation",
  );
  console.log(
    "Recovery grant session binding, one-use reset, token replay denial and global session revocation: PASS",
  );
  const { data: session, error: signInError } =
    await client.auth.signInWithPassword({ email, password: newPassword });
  if (signInError)
    throw new Error("Provider login failed: " + signInError.code);
  accessToken = session.session!.access_token;
  const own = await client.from("balances").select("*");
  assert.equal(own.error, null);
  assert.equal(own.data!.length, 1);
  assert.equal(own.data![0].user_id, userId);
  const protectedPayload = await client.from("signed_transactions").select("*");
  assert.ok(protectedPayload.error);
  const forbiddenRpc = await client.rpc("wallet_transfer", {
    sender: userId,
    recipient_email: "nobody@example.com",
    quantity: 1,
    request_key: crypto.randomUUID(),
  });
  assert.ok(forbiddenRpc.error);
  console.log(
    "Authenticated Data API ownership and privileged RPC denial: PASS",
  );
  const loggedOut = await fetch(origin + "/api/auth", {
    method: "DELETE",
    headers: { Origin: origin, Cookie: cookie },
  });
  assert.equal(loggedOut.status, 200);
  const fresh = await fetch(origin + "/api/wallet");
  assert.equal(fresh.status, 401);
  console.log("Logout and anonymous wallet access denied: PASS");
  assert.equal(
    (await fetch(origin + "/api/wallet", { headers: { Cookie: cookie } }))
      .status,
    401,
  );
  console.log("Revoked session JWT replay denied: PASS");
  const invalidLink = await fetch(
    origin + "/auth/confirm?token_hash=invalid&type=signup",
    { redirect: "manual" },
  );
  assert.equal(
    new URL(invalidLink.headers.get("location")!).pathname,
    "/login",
  );
  console.log("Invalid confirmation link handled safely: PASS");
} finally {
  if (accessToken) await admin.auth.admin.signOut(accessToken, "global");
  await client.auth.signOut();
  if (userId) {
    await transaction(async (db) => {
      const funds = (
        await db.query(
          "SELECT available,reserved FROM balances WHERE user_id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      assert.ok(
        !funds ||
          (BigInt(funds.available) === 0n && BigInt(funds.reserved) === 0n),
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS total FROM transactions WHERE user_id=$1",
            [userId],
          )
        ).rows[0].total,
        0,
      );
      await db.query("DELETE FROM balances WHERE user_id=$1", [userId]);
      await db.query(
        "DELETE FROM audit_logs WHERE actor=$1 AND action='auth.password_recovered'",
        [userId],
      );
      await db.query("DELETE FROM profiles WHERE id=$1", [userId]);
    });
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error)
      throw new Error("QA cleanup failed: " + removed.error.code);
    console.log(
      "Disposable QA account and zero-balance profile cleaned up: PASS",
    );
  }
  await pool.end();
}
