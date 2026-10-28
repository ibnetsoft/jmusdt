// Reference signer for development/Nile. Run as an isolated private service.
// For mainnet, replace with HSM/MPC custody implementing the same contract.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { HDNodeWallet } from "ethers";
import { TronWeb, type Types } from "tronweb";
import { z } from "zod";
import { database } from "../src/lib/db";
import { chainConfig, tronClient } from "../src/lib/tron";
import {
  validateTransfer,
  validateNative,
  type Unsigned,
  type NativeUnsigned,
} from "../src/lib/tron-transaction";
import { ensureChainBinding } from "../src/lib/chain-binding";
const token = process.env.CUSTODY_TOKEN,
  mnemonic = process.env.CUSTODY_MNEMONIC,
  hotKey = process.env.CUSTODY_HOT_PRIVATE_KEY;
if (!token || token.length < 32 || !mnemonic || !hotKey)
  throw new Error(
    "Custody token (32+ chars), mnemonic, and hot private key required",
  );
const config = chainConfig();
if (config.network !== "nile")
  throw new Error(
    "Reference signer is restricted to Nile; use HSM/MPC service for mainnet",
  );
const pool = database(),
  tron = tronClient();
await ensureChainBinding();
const hot = TronWeb.address.fromPrivateKey(hotKey);
if (!hot || hot !== process.env.TRON_HOT_WALLET_ADDRESS)
  throw new Error("Hot key/address mismatch");
function derive(index: string) {
  if (!/^\d+$/.test(index) || BigInt(index) > 2147483647n)
    throw new Error("Invalid derivation index");
  return HDNodeWallet.fromPhrase(
    mnemonic!,
    undefined,
    `m/44'/195'/0'/0/${index}`,
  ).privateKey.slice(2);
}
function authorize(header: string | undefined) {
  const expected = Buffer.from("Bearer " + token),
    provided = Buffer.from(header || "");
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST" || !authorize(request.headers.authorization)) {
    response.writeHead(403);
    response.end('{"error":"Forbidden"}');
    return;
  }
  try {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 64000) throw new Error("Body too large");
    }
    const input = JSON.parse(body);
    if (input.network !== config.network) throw new Error("Network mismatch");
    if (request.url === "/addresses") {
      const parsed = z
        .object({
          index: z.string().regex(/^\d+$/),
          idempotencyKey: z.string().max(150),
        })
        .parse(input);
      const address = TronWeb.address.fromPrivateKey(derive(parsed.index));
      response.end(JSON.stringify({ address }));
      return;
    }
    if (request.url !== "/sign") throw new Error("Unknown operation");
    const { id, kind } = z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["withdrawal", "sweep", "sweep_gas"]),
      })
      .parse(input);
    const tx = input.transaction as Types.Transaction;
    let owner: string,
      key: string,
      to: string,
      amount: string,
      storedTxid: string;
    if (kind === "withdrawal") {
      const row = (
        await pool.query(
          `SELECT t.*,s.txid AS stored_txid FROM transactions t JOIN signed_transactions s ON s.transaction_id=t.id JOIN profiles p ON p.id=t.user_id WHERE t.id=$1 AND t.status='signing' AND p.status='active'`,
          [id],
        )
      ).rows[0];
      if (!row) throw new Error("Not approved for signing");
      owner = hot as string;
      key = hotKey!;
      to = row.destination;
      amount = row.amount;
      storedTxid = row.stored_txid;
    } else {
      const row = (
        await pool.query(
          `SELECT j.*,a.address,a.derivation_index AS current_index,o.txid AS stored_txid,o.payload AS stored_payload,o.amount AS transfer_amount,c.max_topup AS current_cap FROM sweep_jobs j JOIN deposit_addresses a ON a.user_id=j.user_id JOIN sweep_outbox o ON o.job_id=j.id JOIN sweep_settings c ON c.id=true WHERE j.id=$1 AND j.review_id IS NOT NULL AND j.status IN ('gas_funding','signing') AND c.enabled AND o.phase=$2 AND o.status IN ('prepared','signed')`,
          [id, kind === "sweep_gas" ? "gas" : "token"],
        )
      ).rows[0];
      if (!row) throw new Error("Sweep not approved");
      const memberKey = derive(String(row.derivation_index));
      if (
        row.network !== config.network ||
        row.contract !== config.contract ||
        row.destination !== hot ||
        row.source !== row.address ||
        String(row.current_index) !== String(row.derivation_index) ||
        tx.raw_data_hex !== row.stored_payload.raw_data_hex ||
        row.fee_limit !== String(process.env.TRON_FEE_LIMIT_SUN || 100000000)
      )
        throw new Error("Sweep snapshot mismatch");
      if (TronWeb.address.fromPrivateKey(memberKey) !== row.source)
        throw new Error("Derivation mismatch");
      storedTxid = row.stored_txid;
      if (kind === "sweep_gas") {
        if (
          BigInt(row.transfer_amount) > BigInt(row.max_topup) ||
          BigInt(row.transfer_amount) > BigInt(row.current_cap) ||
          BigInt(row.transfer_amount) > 100000000n
        )
          throw new Error("Gas cap exceeded");
        owner = hot as string;
        to = row.source;
        key = hotKey!;
        amount = row.transfer_amount;
      } else {
        key = memberKey;
        owner = row.source;
        to = hot as string;
        amount = row.amount;
      }
    }
    if (tx.txID !== storedTxid || tx.raw_data.expiration <= Date.now())
      throw new Error("Unknown or expired transaction");
    if (kind === "sweep_gas")
      validateNative(tx as NativeUnsigned, { owner, to, amount });
    else
      validateTransfer(tx as Unsigned, {
        owner,
        contract: config.contract!,
        to,
        amount,
        feeLimit: Number(process.env.TRON_FEE_LIMIT_SUN || 100000000),
      });
    const signed = await tron.trx.sign(tx, key);
    response.end(JSON.stringify(signed));
  } catch (error) {
    console.error(
      "Custody rejected request:",
      error instanceof Error ? error.message : "Unknown error",
    );
    response.writeHead(400);
    response.end('{"error":"Custody rejected request"}');
  }
});
server.requestTimeout = 25000;
server.headersTimeout = 10000;
server.listen(8787, "127.0.0.1", () =>
  console.log("Nile custody reference listening on 127.0.0.1:8787"),
);
function shutdown() {
  server.close(() => {
    void pool.end();
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
