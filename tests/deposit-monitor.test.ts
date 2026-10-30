import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { TronWeb } from "tronweb";
import { SweepChain } from "../src/lib/sweep-chain";
import { MAINNET_USDT } from "../src/lib/tron";
import { TRANSFER_TOPIC } from "../src/lib/tron-transaction";
import { runDepositScan } from "../src/lib/deposit-monitor";

test("confirmed USDT deposits update balances once and invalid blocks leave the cursor unchanged", async () => {
  const db = new PGlite();
  const oldNetwork = process.env.TRON_NETWORK;
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const oldPool = (globalThis as any).walletPool;
  const oldRpc = SweepChain.prototype.rpc;
  const user = crypto.randomUUID();
  const address = TronWeb.address.fromPrivateKey("1".padStart(64,"0")) as string;
  const topic = (addr:string) => TronWeb.address.toHex(addr).slice(2).padStart(64,"0");
  const receipt = {id:"a".repeat(64),blockNumber:101,blockTimeStamp:Date.now()+60000,receipt:{result:"SUCCESS"},log:[{address:TronWeb.address.toHex(MAINNET_USDT).slice(2),topics:[TRANSFER_TOPIC,topic(address),topic(address)],data:(1234567).toString(16).padStart(64,"0")} ]};
  let malformed = false;
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
    await db.exec(await readFile(new URL("../db/schema.sql",import.meta.url),"utf8"));
    await db.query("INSERT INTO auth.users VALUES($1)",[user]);
    await db.query("INSERT INTO profiles(id,email,name) VALUES($1,'deposit@example.com','test')",[user]);
    await db.query("INSERT INTO deposit_addresses(user_id,address,network) VALUES($1,$2,'mainnet')",[user,address]);
    await db.query("INSERT INTO chain_cursor(network,block_number) VALUES('mainnet',100)");
    const query = async (sql:string, args:unknown[] = []) => {const r=await db.query<any>(sql,args);return {...r,rowCount:r.rows.length};};
    (globalThis as any).walletPool = {query,connect:async()=>({query,release(){}})};
    process.env.TRON_NETWORK="mainnet";
    process.env.DATABASE_URL="postgres://test:password@localhost/test";
    SweepChain.prototype.rpc = async function(method:string) {return (method.endsWith("getnowblock") ? {block_header:{raw_data:{number:101}}} : malformed ? {} : [receipt]) as any;};
    assert.equal((await runDepositScan()).credited,1);
    assert.equal((await db.query<any>("SELECT available FROM balances WHERE user_id=$1",[user])).rows[0].available,1234567);
    await db.query("UPDATE chain_cursor SET block_number=100");
    assert.equal((await runDepositScan()).credited,0);
    assert.equal((await db.query<any>("SELECT count(*)::int AS count FROM deposit_events")).rows[0].count,1);
    await db.query("UPDATE chain_cursor SET block_number=100");
    malformed=true;
    await assert.rejects(runDepositScan(),/Invalid block receipt response/);
    assert.equal((await db.query<any>("SELECT block_number FROM chain_cursor")).rows[0].block_number,100);
  } finally {
    SweepChain.prototype.rpc=oldRpc;
    (globalThis as any).walletPool=oldPool;
    if(oldDatabaseUrl===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=oldDatabaseUrl;
    if(oldNetwork===undefined) delete process.env.TRON_NETWORK; else process.env.TRON_NETWORK=oldNetwork;
    await db.close();
  }
});

