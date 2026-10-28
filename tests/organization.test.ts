import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("referral signup capture and L/R placement preserve referral, reject unauthorized, occupied and cyclic positions", async () => {
  const db = new PGlite();
  const a = crypto.randomUUID(),
    b = crypto.randomUUID(),
    c = crypto.randomUUID(),
    d = crypto.randomUUID(),
    outsider = crypto.randomUUID();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
    );
    for (const file of ["schema.sql", "organization.sql"])
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    const create = async (id: string, email: string, code?: string) => {
      await db.query(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)",
        [id, email, JSON.stringify({ name: email, referral_code: code })],
      );
      await db.query(
        "UPDATE member_network SET activated_at=now() WHERE user_id=$1",
        [id],
      );
      return (
        await db.query<{ referral_code: string }>(
          "SELECT referral_code FROM member_network WHERE user_id=$1",
          [id],
        )
      ).rows[0].referral_code;
    };
    const code = await create(a, "a@example.com");
    await create(b, "b@example.com", code);
    await create(c, "c@example.com", code);
    await create(d, "d@example.com", code);
    await create(outsider, "outsider@example.com");
    const place = (who: string, member: string, parent: string, slot: string) =>
      db.query("SELECT network_place($1,$2,$3,$4)", [
        who,
        member,
        parent,
        slot,
      ]);
    await place(a, b, a, "L");
    await place(a, b, a, "L");
    assert.equal(
      (
        await db.query(
          "SELECT * FROM audit_logs WHERE action='organization.placed'",
        )
      ).rows.length,
      1,
    );
    await assert.rejects(place(a, c, a, "L"), /SLOT_OCCUPIED/);
    await assert.rejects(place(outsider, c, a, "R"), /NOT_MY_REFERRAL/);
    await assert.rejects(place(a, c, outsider, "L"), /OUTSIDE_NETWORK/);
    await assert.rejects(place(a, c, c, "L"), /NETWORK_CYCLE/);
    await place(a, c, b, "R");
    assert.equal(
      (
        await db.query<{ referrer_id: string }>(
          "SELECT referrer_id FROM member_network WHERE user_id=$1",
          [c],
        )
      ).rows[0].referrer_id,
      a,
    );
    await assert.rejects(place(a, b, c, "L"), /NETWORK_CYCLE/);
    await assert.rejects(place(a, c, a, "R"), /ALREADY_PLACED/);
    await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [d]);
    await assert.rejects(place(a, d, a, "R"), /NOT_MY_REFERRAL/);
    await db.query("UPDATE auth.users SET raw_user_meta_data=$2 WHERE id=$1", [
      c,
      JSON.stringify({ referral_code: "000000000000" }),
    ]);
    assert.equal(
      (
        await db.query<{ referrer_id: string }>(
          "SELECT referrer_id FROM member_network WHERE user_id=$1",
          [c],
        )
      ).rows[0].referrer_id,
      a,
    );
    await assert.rejects(
      create(crypto.randomUUID(), "bad@example.com", "000000000000"),
      /INVALID_REFERRAL/,
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(place(a, d, a, "R"), /permission denied/);
  } finally {
    await db.close();
  }
});
