import { database } from "./db";
import { ensureChainBinding } from "./chain-binding";
import { chainConfig } from "./tron";
import { SweepChain } from "./sweep-chain";
import { decodeDeposits, type Receipt } from "./tron-transaction";

// The cursor is established before an address can be issued. Existing addresses
// require an explicit historical start block to avoid silently missing deposits.
export async function initializeDepositCursor() {
  await ensureChainBinding();
  const { network } = chainConfig();
  const pool = database();
  if ((await pool.query("SELECT 1 FROM chain_cursor WHERE network=$1", [network])).rowCount) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["tron-scan:" + network]);
    if (!(await client.query("SELECT 1 FROM chain_cursor WHERE network=$1", [network])).rowCount) {
      const chain = new SweepChain();
      const head = await chain.rpc<{block_header?: {raw_data?: {number?: number}}}>("walletsolidity/getnowblock", {});
      const safe = head.block_header?.raw_data?.number;
      if (!Number.isSafeInteger(safe) || safe! < 1) throw new Error("Invalid solid head");
      const existing = await client.query("SELECT 1 FROM deposit_addresses WHERE network=$1 AND address IS NOT NULL LIMIT 1", [network]);
      const configured = process.env.TRON_START_BLOCK;
      const start = configured ? Number(configured) : safe! + 1;
      if ((existing.rowCount && !configured) || !Number.isSafeInteger(start) || start < 1 || start > safe! + 1)
        throw new Error("Existing deposit addresses require a valid historical TRON_START_BLOCK");
      await client.query("INSERT INTO chain_cursor(network,block_number) VALUES($1,$2)", [network, start - 1]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function runDepositScan() {
  await initializeDepositCursor();
  const { network, contract } = chainConfig();
  if (!contract) throw new Error("USDT contract configuration required");
  const chain = new SweepChain();
  const head = await chain.rpc<{block_header?: {raw_data?: {number?: number}}}>("walletsolidity/getnowblock", {});
  const safe = head.block_header?.raw_data?.number;
  if (!Number.isSafeInteger(safe) || safe! < 1) throw new Error("Invalid solid head");
  const client = await database().connect();
  const deadline = Date.now() + 40000;
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked", ["tron-scan:" + network]);
    if (!lock.rows[0].locked) { await client.query("COMMIT"); return {state: "busy"}; }
    const cursor = Number((await client.query("SELECT block_number FROM chain_cursor WHERE network=$1", [network])).rows[0]?.block_number);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > safe!) throw new Error("Invalid deposit cursor");
    let last = cursor, credited = 0;
    for (let block = cursor + 1; block <= Math.min(cursor + 10, safe!); block++) {
      if (Date.now() >= deadline) break;
      const receipts = await chain.rpc<Receipt[]>("walletsolidity/gettransactioninfobyblocknum", {num: block});
      if (!Array.isArray(receipts)) throw new Error("Invalid block receipt response; cursor not advanced");
      for (const info of receipts) {
        if (info.blockNumber !== block || !Number.isSafeInteger(info.blockTimeStamp) || !/^[a-f0-9]{64}$/i.test(info.id)) throw new Error("Invalid block receipt");
        for (const event of decodeDeposits(info, contract)) {
          const owner = (await client.query("SELECT user_id,created_at FROM deposit_addresses WHERE address=$1 AND network=$2", [event.address, network])).rows[0];
          if (!owner || new Date(owner.created_at).getTime() > info.blockTimeStamp) continue;
          const result = await client.query("SELECT wallet_credit_deposit($1,$2,$3,$4,$5,$6) AS credited", [owner.user_id, event.amount, network, info.id, event.index, block]);
          if (result.rows[0].credited) credited++;
        }
      }
      last = block;
    }
    if (last !== cursor) await client.query("UPDATE chain_cursor SET block_number=$2,updated_at=now() WHERE network=$1", [network,last]);
    await client.query("COMMIT");
    return {state: "ok", block: last, head: safe, credited};
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
