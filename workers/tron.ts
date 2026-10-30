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
import { advanceSweep } from "../src/lib/sweep-worker";
import { runDepositScan } from "../src/lib/deposit-monitor";
import { getTronGridKey } from "../src/lib/tron-api-settings";
const pool = database(),
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
  const apiKey = await getTronGridKey();
  const response = await fetch(`${config.host}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey
        ? { "TRON-PRO-API-KEY": apiKey }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`TRON RPC ${response.status}`);
  return response.json() as Promise<T>;
}
async function scan() {
  await runDepositScan();
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
  const result = await (await tronClient()).transactionBuilder.triggerSmartContract(
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
    const response = await (await tronClient()).trx.sendRawTransaction(payload);
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
  await advanceSweep();
}
// Fail on incorrect token decimals before touching any ledger.
await ensureChainBinding();
const decimals = await (await tronClient()).transactionBuilder.triggerConstantContract(
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
  } catch (error) {
    console.error(
      "TRON worker:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
  if (process.env.TRON_BROADCAST_ENABLED === "true") {
    try {
      await sendWithdrawal();
    } catch {
      console.error("Withdrawal worker retry required");
    }
    try {
      await sweep();
    } catch {
      console.error("Sweep worker retry required");
    }
  }
  await delay(3000);
}
await pool.end();
