import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { TronWeb } from "tronweb";
import { provisionSignupAddress, provisionMissingAddress } from "../src/lib/wallet-service";

test("signup provisions one durable address and retries interrupted provisioning", async () => {
  const db = new PGlite();
  const saved = { pool: (globalThis as any).walletPool, fetch: globalThis.fetch, database: process.env.DATABASE_URL, network: process.env.TRON_NETWORK, url: process.env.CUSTODY_URL, token: process.env.CUSTODY_TOKEN, internal: process.env.INTERNAL_CUSTODY_ENABLED };
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const addressFor = (index: string) => TronWeb.address.fromPrivateKey(BigInt(index).toString(16).padStart(64, "0")) as string;
  let fail = false, calls = 0;
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
    await db.exec(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
    await db.query("INSERT INTO auth.users VALUES($1),($2)", [first, second]);
    await db.query("INSERT INTO profiles(id,email,name) VALUES($1,'one@example.com','one'),($2,'two@example.com','two')", [first, second]);
    await db.query("INSERT INTO chain_cursor(network,block_number) VALUES('mainnet',100)");
    const query = async (sql: string, args: unknown[] = []) => { const r = await db.query<any>(sql, args); return {...r, rowCount: r.rows.length}; };
    (globalThis as any).walletPool = {query, connect: async () => ({query, release(){}})};
    process.env.DATABASE_URL="postgres://test:password@localhost/test"; process.env.TRON_NETWORK="mainnet";
    process.env.CUSTODY_URL="https://custody.example"; process.env.CUSTODY_TOKEN="test-token"; delete process.env.INTERNAL_CUSTODY_ENABLED;
    globalThis.fetch = async (_url, init) => { calls++; if (fail) return new Response(null, {status:503}); const body=JSON.parse(String(init?.body)); return Response.json({address:addressFor(body.index)}); };
    assert.equal(await provisionSignupAddress(crypto.randomUUID()), null);
    assert.equal(calls,0);
    const firstAddress = await provisionSignupAddress(first);
    assert.ok(firstAddress && TronWeb.isAddress(firstAddress));
    assert.equal(await provisionSignupAddress(first), firstAddress);
    assert.equal(calls,1);
    fail = true;
    await assert.rejects(provisionSignupAddress(second));
    const pending = (await db.query<any>("SELECT derivation_index,address FROM deposit_addresses WHERE user_id=$1", [second])).rows[0];
    assert.equal(pending.address,null);
    fail = false;
    assert.equal(await provisionMissingAddress(),true);
    const issued=(await db.query<any>("SELECT derivation_index,address FROM deposit_addresses WHERE user_id=$1",[second])).rows[0];
    assert.equal(issued.derivation_index,pending.derivation_index);
    assert.equal(issued.address,addressFor(String(pending.derivation_index)));
    assert.notEqual(issued.address,firstAddress);
    assert.equal(await provisionMissingAddress(),false);
  } finally {
    (globalThis as any).walletPool=saved.pool; globalThis.fetch=saved.fetch;
    for (const [key,value] of Object.entries({DATABASE_URL:saved.database,TRON_NETWORK:saved.network,CUSTODY_URL:saved.url,CUSTODY_TOKEN:saved.token,INTERNAL_CUSTODY_ENABLED:saved.internal})) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
    await db.close();
  }
});
