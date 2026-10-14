import "../scripts/load-env";
import { setTimeout as delay } from "node:timers/promises";
import { database } from "../src/lib/db";
import {
  chainConfig,
  tronClient,
  custody,
  validTronAddress,
} from "../src/lib/tron";
import {
  decodeDeposits,
  validateTransfer,
  validateSigned,
  type Unsigned,
  type Signed,
  type Receipt,
} from "../src/lib/tron-transaction";
import { ensureChainBinding } from "../src/lib/chain-binding";
const pool = database(),
  tron = tronClient(),
  config = chainConfig();
if (!config.contract || !validTronAddress(config.contract))
  throw new Error("TRON_USDT_CONTRACT is required on Nile");
const contract = config.contract;
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
async function rpc<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.host}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.TRONGRID_API_KEY
        ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`TRON RPC ${response.status}`);
  return response.json() as Promise<T>;
}
async function scan() {
  const head = await rpc<{ block_header: { raw_data: { number: number } } }>(
    "walletsolidity/getnowblock",
    {},
  );
  const safe = head.block_header?.raw_data?.number;
  if (!Number.isSafeInteger(safe)) throw new Error("Invalid solid head");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "tron-scan:" + config.network,
    ]);
    let cursor = (
      await client.query(
        "SELECT block_number FROM chain_cursor WHERE network=$1",
        [config.network],
      )
    ).rows[0]?.block_number;
    if (cursor === undefined) {
      const start = Number(process.env.TRON_START_BLOCK);
      if (
        !process.env.TRON_START_BLOCK ||
        !Number.isSafeInteger(start) ||
        start < 1 ||
        start > safe
      )
        throw new Error(
          "Set TRON_START_BLOCK to an existing solid block before first scan",
        );
      cursor = String(start - 1);
    }
    const end = Math.min(Number(cursor) + 10, safe);
    for (let block = Number(cursor) + 1; block <= end; block++) {
      const receipts = await rpc<Receipt[]>(
        "walletsolidity/gettransactioninfobyblocknum",
        { num: block },
      );
      if (!Array.isArray(receipts))
        throw new Error("Invalid block receipt response; cursor not advanced");
      for (const info of receipts) {
        if (info.blockNumber !== block)
          throw new Error("Receipt block mismatch");
        for (const event of decodeDeposits(info, contract)) {
          const owner = (
            await client.query(
              "SELECT user_id,created_at FROM deposit_addresses WHERE address=$1 AND network=$2",
              [event.address, config.network],
            )
          ).rows[0];
          if (
            !owner ||
            new Date(owner.created_at).getTime() > info.blockTimeStamp
          )
            continue;
          await client.query(
            "SELECT wallet_credit_deposit($1,$2,$3,$4,$5,$6)",
            [
              owner.user_id,
              event.amount,
              config.network,
              info.id,
              event.index,
              block,
            ],
          );
        }
      }
      await client.query(
        "INSERT INTO chain_cursor(network,block_number) VALUES($1,$2) ON CONFLICT(network) DO UPDATE SET block_number=EXCLUDED.block_number,updated_at=now()",
        [config.network, block],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
function feeLimit() {
  const value = Number(process.env.TRON_FEE_LIMIT_SUN || 100000000);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000000)
    throw new Error("Invalid fee limit");
  return value;
}
async function build(
  owner: string,
  to: string,
  amount: string,
): Promise<Unsigned> {
  const result = await tron.transactionBuilder.triggerSmartContract(
    contract,
    "transfer(address,uint256)",
    { feeLimit: feeLimit(), callValue: 0 },
    [
      { type: "address", value: to },
      { type: "uint256", value: amount },
    ],
    owner,
  );
  if (!result.result?.result) throw new Error("Cannot build transfer");
  const tx = result.transaction;
  validateTransfer(tx, { owner, contract, to, amount, feeLimit: feeLimit() });
  return tx;
}
async function sendWithdrawal() {
  const hot = process.env.TRON_HOT_WALLET_ADDRESS;
  if (!hot || !validTronAddress(hot))
    throw new Error("Valid hot wallet required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Global outbound lock avoids multiple uncommitted custody requests.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "tron-outbound:" + config.network,
    ]);
    const row = (
      await client.query(`SELECT t.*,p.status AS member_status,s.payload,s.expiration,s.txid AS signed_txid FROM transactions t
      JOIN profiles p ON p.id=t.user_id LEFT JOIN signed_transactions s ON s.transaction_id=t.id
      WHERE t.kind='withdrawal' AND (t.status='broadcast' OR (t.status='signing' AND (p.status='active' OR s.payload ? 'signature')) OR (t.status='approved' AND p.status='active'))
      ORDER BY CASE WHEN t.status IN('signing','broadcast') AND p.status='active' AND s.expiration>extract(epoch from now())*1000 THEN 0 WHEN t.status='approved' THEN 1 ELSE 2 END,t.updated_at LIMIT 1 FOR UPDATE OF t`)
    ).rows[0];
    if (!row) {
      await client.query("COMMIT");
      return;
    }
    if (!row.payload) {
      const tx = await build(hot, row.destination, row.amount);
      await client.query(
        "INSERT INTO signed_transactions(transaction_id,txid,payload,expiration) VALUES($1,$2,$3,$4)",
        [row.id, tx.txID, JSON.stringify(tx), tx.raw_data.expiration],
      );
      await client.query(
        "UPDATE transactions SET status='signing',txid=$2,updated_at=now() WHERE id=$1",
        [row.id, tx.txID],
      );
      await client.query("COMMIT");
      return; // Persist unsigned tx BEFORE contacting signer.
    }
    const receipt = await rpc<Receipt>(
      "walletsolidity/gettransactioninfobyid",
      { value: row.signed_txid },
    );
    if (receipt.id) {
      const success =
        receipt.receipt?.result === "SUCCESS" &&
        decodeDeposits(receipt, contract).some(
          (event) =>
            event.address === row.destination && event.amount === row.amount,
        );
      // A successful call without the expected event is ambiguous: retain funds.
      if (receipt.receipt?.result === "SUCCESS" && !success)
        throw new Error(
          "Receipt needs manual investigation: missing transfer event",
        );
      if (!receipt.receipt?.result && receipt.result !== "FAILED")
        throw new Error("Unknown receipt outcome");
      await client.query("SELECT wallet_settle_withdrawal($1,$2,$3)", [
        row.id,
        success,
        row.signed_txid,
      ]);
      await client.query("COMMIT");
      return;
    }
    if (
      Number(row.expiration) <= Date.now() ||
      row.member_status !== "active"
    ) {
      // Never build a replacement automatically. RPC absence is not proof of failure.
      await client.query(
        "UPDATE signed_transactions SET last_error='Expired / unconfirmed: manual reconciliation required' WHERE transaction_id=$1",
        [row.id],
      );
      await client.query(
        "UPDATE transactions SET updated_at=now() WHERE id=$1",
        [row.id],
      );
      await client.query("COMMIT");
      return;
    }
    let payload = row.payload as Signed;
    validateTransfer(payload, {
      owner: hot,
      contract,
      to: row.destination,
      amount: row.amount,
      feeLimit: feeLimit(),
    });
    if (!payload.signature) {
      const signed = await custody<Signed>("/sign", {
        network: config.network,
        kind: "withdrawal",
        id: row.id,
        transaction: payload,
      });
      validateSigned(payload, signed);
      await client.query(
        "UPDATE signed_transactions SET payload=$2 WHERE transaction_id=$1",
        [row.id, JSON.stringify(signed)],
      );
      await client.query("COMMIT");
      return; // Persist signature BEFORE broadcasting.
    }
    const response = await tron.trx.sendRawTransaction(payload);
    if (!response.result && String(response.code) !== "DUP_TRANSACTION_ERROR")
      throw new Error(
        "Broadcast rejected; retain reservation for investigation",
      );
    await client.query(
      "UPDATE transactions SET status='broadcast',updated_at=now() WHERE id=$1",
      [row.id],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function sweep() {
  const hot = process.env.TRON_HOT_WALLET_ADDRESS;
  if (!hot || !validTronAddress(hot))
    throw new Error("Valid hot wallet required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "tron-sweep:" + config.network,
    ]);
    const row = (
      await client.query(
        `SELECT j.*,a.address,a.derivation_index FROM sweep_jobs j JOIN deposit_addresses a ON a.user_id=j.user_id
      WHERE j.status IN('requested','signing','broadcast') AND a.network=$1
      ORDER BY CASE WHEN j.status IN('signing','broadcast') AND j.expiration>extract(epoch from now())*1000 THEN 0 WHEN j.status='requested' THEN 1 ELSE 2 END,j.updated_at LIMIT 1 FOR UPDATE OF j`,
        [config.network],
      )
    ).rows[0];
    if (!row) {
      await client.query("COMMIT");
      return;
    }
    if (!row.payload) {
      const result = await tron.transactionBuilder.triggerConstantContract(
        contract,
        "balanceOf(address)",
        {},
        [{ type: "address", value: row.address }],
        hot,
      );
      const amount = BigInt("0x" + result.constant_result?.[0]);
      if (amount === 0n) {
        await client.query(
          "UPDATE sweep_jobs SET status='completed',note='No balance to sweep' WHERE id=$1",
          [row.id],
        );
        await client.query("COMMIT");
        return;
      }
      const tx = await build(row.address, hot, amount.toString());
      await client.query(
        "UPDATE sweep_jobs SET status='signing',amount=$2,payload=$3,txid=$4,expiration=$5,updated_at=now() WHERE id=$1",
        [
          row.id,
          amount.toString(),
          JSON.stringify(tx),
          tx.txID,
          tx.raw_data.expiration,
        ],
      );
      await client.query("COMMIT");
      return;
    }
    const receipt = await rpc<Receipt>(
      "walletsolidity/gettransactioninfobyid",
      { value: row.txid },
    );
    if (receipt.id) {
      const success =
        receipt.receipt?.result === "SUCCESS" &&
        decodeDeposits(receipt, contract).some(
          (event) => event.address === hot && event.amount === row.amount,
        );
      if (receipt.receipt?.result === "SUCCESS" && !success)
        throw new Error("Ambiguous sweep receipt");
      if (!receipt.receipt?.result && receipt.result !== "FAILED")
        throw new Error("Unknown sweep outcome");
      await client.query("UPDATE sweep_jobs SET status=$2 WHERE id=$1", [
        row.id,
        success ? "completed" : "failed",
      ]);
      await client.query(
        "INSERT INTO audit_logs(action,details) VALUES($1,$2)",
        [
          "sweep.settled",
          JSON.stringify({ id: row.id, txid: row.txid, success }),
        ],
      );
      await client.query("COMMIT");
      return;
    }
    if (Number(row.expiration) <= Date.now()) {
      await client.query(
        "UPDATE sweep_jobs SET note='Expired / unconfirmed: manual reconciliation required',updated_at=now() WHERE id=$1",
        [row.id],
      );
      await client.query("COMMIT");
      return;
    }
    const payload = row.payload as Signed;
    validateTransfer(payload, {
      owner: row.address,
      contract,
      to: hot,
      amount: row.amount,
      feeLimit: feeLimit(),
    });
    if (!payload.signature) {
      const signed = await custody<Signed>("/sign", {
        network: config.network,
        kind: "sweep",
        id: row.id,
        transaction: payload,
      });
      validateSigned(payload, signed);
      await client.query("UPDATE sweep_jobs SET payload=$2 WHERE id=$1", [
        row.id,
        JSON.stringify(signed),
      ]);
      await client.query("COMMIT");
      return;
    }
    const response = await tron.trx.sendRawTransaction(payload);
    if (!response.result && String(response.code) !== "DUP_TRANSACTION_ERROR")
      throw new Error("Sweep broadcast rejected");
    await client.query("UPDATE sweep_jobs SET status='broadcast' WHERE id=$1", [
      row.id,
    ]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
// Fail on incorrect token decimals before touching any ledger.
await ensureChainBinding();
const decimals = await tron.transactionBuilder.triggerConstantContract(
  contract,
  "decimals()",
  {},
  [],
  contract,
);
if (BigInt("0x" + decimals.constant_result?.[0]) !== 6n)
  throw new Error("USDT contract must have 6 decimals");
console.log(
  `TRON worker started (${config.network}); broadcast ${process.env.TRON_BROADCAST_ENABLED === "true" ? "enabled" : "disabled"}`,
);
while (!stopped) {
  try {
    await scan();
    if (process.env.TRON_BROADCAST_ENABLED === "true") {
      await sendWithdrawal();
      await sweep();
    }
  } catch (error) {
    console.error(
      "TRON worker:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
  await delay(3000);
}
await pool.end();
