import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "00000000-0000-4000-8000-000000000001",
  bob = "00000000-0000-4000-8000-000000000002",
  admin = "00000000-0000-4000-8000-000000000003";
async function setup() {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`,
  );
  await db.exec(
    await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  await db.query("INSERT INTO auth.users VALUES($1),($2),($3)", [
    alice,
    bob,
    admin,
  ]);
  await db.query(
    "INSERT INTO profiles(id,email,name) VALUES($1,'alice@example.com','Alice'),($2,'bob@example.com','Bob'),($3,'admin@example.com','Admin')",
    [alice, bob, admin],
  );
  await db.query("INSERT INTO balances(user_id) VALUES($1),($2),($3)", [
    alice,
    bob,
    admin,
  ]);
  await db.query("SELECT wallet_credit_deposit($1,100000000,$2,$3,0,100)", [
    alice,
    "nile",
    "seed",
  ]);
  return db;
}
async function balance(db: PGlite, id = alice) {
  return (
    await db.query<{ available: number; reserved: number }>(
      "SELECT * FROM balances WHERE user_id=$1",
      [id],
    )
  ).rows[0];
}
test("deposit events are idempotent by network / txid / log index", async () => {
  const db = await setup();
  try {
    await db.query(
      "SELECT wallet_credit_deposit($1,100000000,'nile','seed',0,100)",
      [alice],
    );
    assert.equal((await balance(db)).available, 100000000);
    await db.query(
      "SELECT wallet_credit_deposit($1,5000000,'nile','seed',1,100)",
      [alice],
    );
    assert.equal((await balance(db)).available, 105000000);
  } finally {
    await db.close();
  }
});
test("transfer is atomic, idempotent, and rejects a changed request key", async () => {
  const db = await setup();
  const key = crypto.randomUUID();
  try {
    await db.query("SELECT wallet_transfer($1,$2,$3,$4)", [
      alice,
      "bob@example.com",
      25000000,
      key,
    ]);
    await db.query("SELECT wallet_transfer($1,$2,$3,$4)", [
      alice,
      "bob@example.com",
      25000000,
      key,
    ]);
    assert.equal((await balance(db)).available, 75000000);
    assert.equal((await balance(db, bob)).available, 25000000);
    await assert.rejects(
      db.query("SELECT wallet_transfer($1,$2,$3,$4)", [
        alice,
        "bob@example.com",
        26000000,
        key,
      ]),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      db.query("SELECT wallet_transfer($1,$2,$3,$4)", [
        alice,
        "bob@example.com",
        80000000,
        crypto.randomUUID(),
      ]),
      /INSUFFICIENT_BALANCE/,
    );
    assert.equal((await balance(db, bob)).available, 25000000);
  } finally {
    await db.close();
  }
});
test("withdrawal reserves funds once; rejection refunds once", async () => {
  const db = await setup(),
    key = crypto.randomUUID();
  try {
    const result = await db.query<{ id: string }>(
      "SELECT wallet_request_withdrawal($1,$2,20000000,1000000,$3) AS id",
      [alice, "T-test", key],
    );
    const id = result.rows[0].id;
    await db.query(
      "SELECT wallet_request_withdrawal($1,$2,20000000,1000000,$3)",
      [alice, "T-test", key],
    );
    assert.equal((await balance(db)).available, 79000000);
    assert.equal((await balance(db)).reserved, 21000000);
    await db.query(
      "SELECT wallet_decide_withdrawal($1,$2,'rejected','test rejection')",
      [id, admin],
    );
    await assert.rejects(
      db.query("SELECT wallet_decide_withdrawal($1,$2,'rejected','again')", [
        id,
        admin,
      ]),
      /INVALID_STATE/,
    );
    assert.equal((await balance(db)).available, 100000000);
    assert.equal((await balance(db)).reserved, 0);
  } finally {
    await db.close();
  }
});
test("confirmed withdrawal settles only against persisted tx; success + fee conserve journal", async () => {
  const db = await setup();
  try {
    const result = await db.query<{ id: string }>(
      "SELECT wallet_request_withdrawal($1,$2,20000000,1000000,$3) AS id",
      [alice, "T-test", crypto.randomUUID()],
    );
    const id = result.rows[0].id;
    await db.query(
      "SELECT wallet_decide_withdrawal($1,$2,'approved','test approval')",
      [id, admin],
    );
    await assert.rejects(
      db.query("SELECT wallet_settle_withdrawal($1,true,'not-persisted')", [
        id,
      ]),
      /INVALID_STATE/,
    );
    await db.query(
      "INSERT INTO signed_transactions(transaction_id,txid,payload,expiration) VALUES($1,'hash','{}',123)",
      [id],
    );
    await db.query("UPDATE transactions SET status='broadcast' WHERE id=$1", [
      id,
    ]);
    await db.query("SELECT wallet_settle_withdrawal($1,true,'hash')", [id]);
    await db.query("SELECT wallet_settle_withdrawal($1,true,'hash')", [id]);
    assert.equal((await balance(db)).available, 79000000);
    assert.equal((await balance(db)).reserved, 0);
    const sums = await db.query(
      "SELECT batch_id FROM journal GROUP BY batch_id HAVING sum(units)<>0",
    );
    assert.equal(sums.rows.length, 0);
    assert.equal(
      BigInt(
        (
          await db.query<{ sum: string }>(
            "SELECT sum(units) FROM journal WHERE account='fees'",
          )
        ).rows[0].sum,
      ),
      1000000n,
    );
  } finally {
    await db.close();
  }
});
test("confirmed chain failure refunds reserved balance, blocked recipient prevents internal transfer", async () => {
  const db = await setup();
  try {
    await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [bob]);
    await assert.rejects(
      db.query("SELECT wallet_transfer($1,$2,1000000,$3)", [
        alice,
        "bob@example.com",
        crypto.randomUUID(),
      ]),
      /ACCOUNT_BLOCKED/,
    );
    const result = await db.query<{ id: string }>(
      "SELECT wallet_request_withdrawal($1,$2,20000000,1000000,$3) AS id",
      [alice, "T-test", crypto.randomUUID()],
    );
    const id = result.rows[0].id;
    await db.query(
      "INSERT INTO signed_transactions(transaction_id,txid,payload,expiration) VALUES($1,'failed-hash','{}',123)",
      [id],
    );
    await db.query("UPDATE transactions SET status='broadcast' WHERE id=$1", [
      id,
    ]);
    await db.query("SELECT wallet_settle_withdrawal($1,false,'failed-hash')", [
      id,
    ]);
    assert.equal((await balance(db)).available, 100000000);
  } finally {
    await db.close();
  }
});
test("browser roles cannot invoke ledger operations or read custody data; journal is append only", async () => {
  const db = await setup();
  try {
    const privileges = await db.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('authenticated','wallet_transfer(uuid,text,bigint,uuid)','EXECUTE') AS allowed",
    );
    assert.equal(privileges.rows[0].allowed, false);
    const tables = await db.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('authenticated','signed_transactions','SELECT') AS allowed",
    );
    assert.equal(tables.rows[0].allowed, false);
    await assert.rejects(
      db.query("UPDATE journal SET units=1"),
      /IMMUTABLE_JOURNAL/,
    );
    const id = (
      await db.query<{ id: string }>("SELECT id FROM transactions LIMIT 1")
    ).rows[0].id;
    await assert.rejects(
      db.query(
        "INSERT INTO journal(transaction_id,batch_id,account,units) VALUES($1,$2,'bad',1)",
        [id, crypto.randomUUID()],
      ),
      /UNBALANCED_JOURNAL/,
    );
  } finally {
    await db.close();
  }
});
