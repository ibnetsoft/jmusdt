// Reference signer for development/Nile. Run as an isolated private service.
// For mainnet, replace with HSM/MPC custody implementing the same contract.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { HDNodeWallet } from "ethers";
import { TronWeb } from "tronweb";
import { z } from "zod";
import { database } from "../src/lib/db";
import { chainConfig, tronClient } from "../src/lib/tron";
import { validateTransfer, type Unsigned } from "../src/lib/tron-transaction";
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
      .object({ id: z.string().uuid(), kind: z.enum(["withdrawal", "sweep"]) })
      .parse(input);
    const tx = input.transaction as Unsigned;
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
          `SELECT j.*,a.address,a.derivation_index FROM sweep_jobs j JOIN deposit_addresses a ON a.user_id=j.user_id WHERE j.id=$1 AND j.status='signing'`,
          [id],
        )
      ).rows[0];
      if (!row) throw new Error("Sweep not approved");
      key = derive(String(row.derivation_index));
      owner = row.address;
      to = hot as string;
      amount = row.amount;
      storedTxid = row.txid;
      if (TronWeb.address.fromPrivateKey(key) !== owner)
        throw new Error("Derivation mismatch");
    }
    if (tx.txID !== storedTxid || tx.raw_data.expiration <= Date.now())
      throw new Error("Unknown or expired transaction");
    validateTransfer(tx, {
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
