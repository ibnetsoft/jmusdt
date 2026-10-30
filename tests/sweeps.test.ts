import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { TronWeb, Types, utils } from "tronweb";
import { SweepChain, SweepError, gasBudget } from "../src/lib/sweep-chain";
import { advanceSweep } from "../src/lib/sweep-worker";
import { MAINNET_USDT } from "../src/lib/tron";
import { reviewToken, verifyReviewToken } from "../src/lib/sweeps";
import {
  validateNative,
  validateSigned,
  transferCalldata,
  TRANSFER_TOPIC,
  matchesTokenTransfer,
  type NativeUnsigned,
  type Unsigned,
} from "../src/lib/tron-transaction";
const memberKey = "1".padStart(64, "0"),
  companyKey = "2".padStart(64, "0");
const source = TronWeb.address.fromPrivateKey(memberKey) as string,
  company = TronWeb.address.fromPrivateKey(companyKey) as string;
function seal<T extends Types.Transaction>(tx: T): T {
  const pb = utils.transaction.txJsonToPb(tx);
  tx.raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase();
  tx.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, "").toLowerCase();
  return tx;
}
function native(amount: string) {
  return seal<NativeUnsigned>({
    visible: false,
    txID: "",
    raw_data_hex: "",
    raw_data: {
      timestamp: Date.now(),
      expiration: Date.now() + 60000,
      ref_block_bytes: "abcd",
      ref_block_hash: "0123456789abcdef",
      contract: [
        {
          type: Types.ContractType.TransferContract,
          parameter: {
            type_url: "type.googleapis.com/protocol.TransferContract",
            value: {
              owner_address: TronWeb.address.toHex(company),
              to_address: TronWeb.address.toHex(source),
              amount: Number(amount),
            },
          },
        },
      ],
    },
  });
}
function token(amount: string, feeLimit: number) {
  return seal<Unsigned>({
    visible: false,
    txID: "",
    raw_data_hex: "",
    raw_data: {
      timestamp: Date.now(),
      expiration: Date.now() + 60000,
      ref_block_bytes: "abcd",
      ref_block_hash: "0123456789abcdef",
      fee_limit: feeLimit,
      contract: [
        {
          type: Types.ContractType.TriggerSmartContract,
          parameter: {
            type_url: "type.googleapis.com/protocol.TriggerSmartContract",
            value: {
              owner_address: TronWeb.address.toHex(source),
              contract_address: TronWeb.address.toHex(MAINNET_USDT),
              data: transferCalldata(company, amount),
              call_value: 0,
            },
          },
        },
      ],
    },
  });
}
function logs(amount: string, from = source) {
  return [
    {
      address: TronWeb.address.toHex(MAINNET_USDT).slice(2),
      topics: [
        TRANSFER_TOPIC,
        TronWeb.address.toHex(from).slice(2).padStart(64, "0"),
        TronWeb.address.toHex(company).slice(2).padStart(64, "0"),
      ],
      data: BigInt(amount).toString(16).padStart(64, "0"),
    },
  ];
}
test("sweep gas budget, review binding and native signing enforce exact intent", async () => {
  assert.deepEqual(gasBudget(100n, 30n, 100n, 1000n), {
    energy: "130",
    feeLimit: "13000",
    required: "1010000",
  });
  const tx = native("5000000");
  validateNative(tx, { owner: company, to: source, amount: "5000000" });
  assert.throws(
    () => validateNative(tx, { owner: company, to: source, amount: "6000000" }),
    /Unexpected native/,
  );
  const altered = structuredClone(tx);
  altered.raw_data.contract[0].parameter.value.amount++;
  assert.throws(
    () =>
      validateNative(altered, {
        owner: company,
        to: source,
        amount: "5000000",
      }),
    /protobuf/,
  );
  const tron = new TronWeb({ fullHost: "https://nile.trongrid.io" });
  validateSigned(tx, await tron.trx.sign(tx, companyKey));
  assert.equal(
    matchesTokenTransfer(logs("1000001"), {
      contract: MAINNET_USDT,
      source,
      target: company,
      amount: "1000001",
    }),
    true,
  );
  assert.equal(
    matchesTokenTransfer(logs("1000001", company), {
      contract: MAINNET_USDT,
      source,
      target: company,
      amount: "1000001",
    }),
    false,
  );
  const saved = process.env.SWEEP_REVIEW_SECRET;
  process.env.SWEEP_REVIEW_SECRET = "x".repeat(32);
  try {
    const r = {
      id: crypto.randomUUID(),
      actor: crypto.randomUUID(),
      expires_at: new Date(),
    };
    const signature = reviewToken(r);
    verifyReviewToken(r, signature);
    assert.throws(() =>
      verifyReviewToken({ ...r, actor: crypto.randomUUID() }, signature),
    );
  } finally {
    if (saved === undefined) delete process.env.SWEEP_REVIEW_SECRET;
    else process.env.SWEEP_REVIEW_SECRET = saved;
  }
});
class FakeChain extends SweepChain {
  memberTrx = "0";
  builds = { gas: 0, token: 0 };
  broadcasts: Types.SignedTransaction[] = [];
  receipts = new Map<string, any>();
  loseOnce = true;
  nativeTx: NativeUnsigned | null = null;
  async verifyToken() {}
  async token() {
    return 1000001n;
  }
  async trx(address: string) {
    return {
      amount: address === company ? "100000000" : this.memberTrx,
      activated: true,
    };
  }
  async estimate() {
    return {
      energy: "65000",
      feeLimit: "6500000",
      required: "5000000",
      companyFee: "2000000",
    };
  }
  async buildGas(_s: string, _t: string, amount: string) {
    this.builds.gas++;
    this.nativeTx = native(amount);
    return this.nativeTx;
  }
  async buildToken(_s: string, _t: string, amount: string, fee: number) {
    this.builds.token++;
    return token(amount, fee);
  }
  async receipt(id: string) {
    return this.receipts.get(id) || {};
  }
  async native() {
    return this.nativeTx!;
  }
  async broadcast(tx: Types.SignedTransaction) {
    this.broadcasts.push(tx);
    if (this.loseOnce) {
      this.loseOnce = false;
      throw new SweepError("전송 응답 유실");
    }
  }
}
test("approved sweep lifecycle persists gas/token outbox, retries same bytes, verifies exact receipt, preserves ledger and holds uncertain transactions", async () => {
  const keys = [
    "TRON_NETWORK",
    "TRON_USDT_CONTRACT",
    "TRON_HOT_WALLET_ADDRESS",
    "TRON_BROADCAST_ENABLED",
    "CUSTODY_URL",
    "CUSTODY_TOKEN",
    "SWEEP_REVIEW_SECRET",
    "TRON_FEE_LIMIT_SUN",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    TRON_NETWORK: "nile",
    TRON_USDT_CONTRACT: MAINNET_USDT,
    TRON_HOT_WALLET_ADDRESS: company,
    TRON_BROADCAST_ENABLED: "true",
    CUSTODY_URL: "http://127.0.0.1:8787",
    CUSTODY_TOKEN: "x".repeat(32),
    SWEEP_REVIEW_SECRET: "x".repeat(32),
    TRON_FEE_LIMIT_SUN: "100000000",
  });
  const db = new PGlite(),
    user = crypto.randomUUID(),
    actor = crypto.randomUUID(),
    outsider = crypto.randomUUID();
  const query = async (sql: string, args: unknown[] = []) =>
      db.query<Record<string, any>>(sql, args),
    one = async (sql: string, args: unknown[] = []) =>
      (await query(sql, args)).rows[0];
  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
  } as unknown as Pool;
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
    );
    for (const f of ["schema.sql", "sweeps.sql"])
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await db.exec("CREATE TABLE company_wallets(id boolean primary key, address text, network text);");
    for (const id of [user, actor, outsider]) {
      await query("INSERT INTO auth.users(id) VALUES($1)", [id]);
      await query("INSERT INTO profiles(id,email,name) VALUES($1,$2,'QA')", [
        id,
        id + "@example.com",
      ]);
      await query(
        "INSERT INTO balances(user_id,available) VALUES($1,1234567)",
        [id],
      );
    }
    await query(
      "INSERT INTO deposit_addresses(user_id,address,network) VALUES($1,$2,'nile')",
      [user, source],
    );
    const index = String(
      (
        await one(
          "SELECT derivation_index FROM deposit_addresses WHERE user_id=$1",
          [user],
        )
      ).derivation_index,
    );
    const items = [
      {
        userId: user,
        source,
        index,
        amount: "1000001",
        topup: "5000000",
        feeLimit: "100000000",
      },
    ];
    const create = async (expired = false) =>
      await one(
        "INSERT INTO sweep_reviews(actor,network,contract,company,settings_version,items,expires_at) VALUES($1,'nile',$2,$3,(SELECT version FROM sweep_settings),$4,now()+$5::interval) RETURNING *",
        [
          actor,
          MAINNET_USDT,
          company,
          JSON.stringify(items),
          expired ? "-1 minute" : "5 minutes",
        ],
      );
    const r = await create();
    await assert.rejects(
      query("SELECT approve_sweep_review($1,$2,'QA approval')", [r.id, actor]),
      /SWEEP_SETTINGS_CHANGED/,
    );
    await query("UPDATE sweep_settings SET enabled=true");
    await assert.rejects(
      query("SELECT approve_sweep_review($1,$2,'QA approval')", [
        r.id,
        outsider,
      ]),
      /NOT_FOUND/,
    );
    const approved = await one(
      "SELECT approve_sweep_review($1,$2,'QA approval') AS jobs",
      [r.id, actor],
    );
    const job = approved.jobs[0];
    assert.equal(
      (
        await one("SELECT approve_sweep_review($1,$2,'QA retry') AS jobs", [
          r.id,
          actor,
        ])
      ).jobs[0],
      job,
    );
    const other = await create();
    await assert.rejects(
      query("SELECT approve_sweep_review($1,$2,'QA duplicate')", [
        other.id,
        actor,
      ]),
      /ALREADY_ACTIVE/,
    );
    await query("INSERT INTO company_wallets(id,address,network) VALUES(true,$1,'nile')", [company]);
    delete process.env.TRON_HOT_WALLET_ADDRESS;
    const chain = new FakeChain(),
      sign = async (_kind: string, _id: string, tx: Types.Transaction) =>
        chain.tron.trx.sign(
          tx,
          tx.raw_data.contract[0].type === "TransferContract"
            ? companyKey
            : memberKey,
        );
    const tick = (now?: number) => advanceSweep(pool, chain, sign, now);
    await query("UPDATE sweep_settings SET enabled=false");
    assert.equal((await tick()).state, "paused");
    assert.equal(chain.builds.gas, 0);
    await query("UPDATE sweep_settings SET enabled=true");
    assert.equal((await tick()).state, "prepared");
    assert.equal(chain.broadcasts.length, 0);
    assert.equal((await tick()).state, "signed");
    assert.equal((await tick()).state, "retry");
    assert.equal((await tick()).state, "broadcast");
    assert.equal(chain.builds.gas, 1);
    assert.equal(chain.broadcasts[0].txID, chain.broadcasts[1].txID);
    assert.deepEqual(chain.broadcasts[0], chain.broadcasts[1]);
    const gas = await one(
      "SELECT * FROM sweep_outbox WHERE job_id=$1 AND phase='gas'",
      [job],
    );
    chain.receipts.set(gas.txid, { id: gas.txid, blockNumber: 1 });
    chain.memberTrx = "5000000";
    assert.equal((await tick()).state, "confirmed");
    assert.equal((await tick()).state, "prepared");
    assert.equal((await tick()).state, "signed");
    assert.equal((await tick()).state, "broadcast");
    const tokenBox = await one(
      "SELECT * FROM sweep_outbox WHERE job_id=$1 AND phase='token'",
      [job],
    );
    chain.receipts.set(tokenBox.txid, {
      id: tokenBox.txid,
      blockNumber: 2,
      receipt: { result: "SUCCESS" },
      log: logs("1000001", company),
    });
    assert.equal((await tick()).state, "needs_review");
    assert.equal(
      (await one("SELECT status FROM sweep_jobs WHERE id=$1", [job])).status,
      "needs_review",
    );
    chain.receipts.set(tokenBox.txid, {
      id: tokenBox.txid,
      blockNumber: 2,
      receipt: { result: "SUCCESS" },
      log: logs("1000001"),
    });
    assert.equal((await tick()).state, "confirmed");
    assert.equal(
      (await one("SELECT status FROM sweep_jobs WHERE id=$1", [job])).status,
      "completed",
    );
    assert.equal(
      (
        await one(
          "SELECT available::text AS available FROM balances WHERE user_id=$1",
          [user],
        )
      ).available,
      "1234567",
    );
    assert.equal(
      (await one("SELECT count(*)::int AS n FROM transactions")).n,
      0,
    );
    assert.equal((await one("SELECT count(*)::int AS n FROM journal")).n, 0);
    const expired = await create(true);
    await assert.rejects(
      query("SELECT approve_sweep_review($1,$2,'QA expired')", [
        expired.id,
        actor,
      ]),
      /EXPIRED/,
    );
    const next = await create();
    const job2 = (
      await one("SELECT approve_sweep_review($1,$2,'QA second') AS jobs", [
        next.id,
        actor,
      ])
    ).jobs[0];
    assert.equal((await tick()).state, "prepared");
    const before = chain.broadcasts.length;
    assert.equal((await tick(Date.now() + 3600000)).state, "needs_review");
    assert.equal(chain.broadcasts.length, before);
    assert.equal(chain.builds.token, 2);
    assert.equal((await tick(Date.now() + 3600000)).state, "needs_review");
    assert.equal(chain.builds.token, 2);
    assert.equal(
      (await one("SELECT status FROM sweep_jobs WHERE id=$1", [job2])).status,
      "needs_review",
    );
    await db.exec(
      await readFile(new URL("../db/sweeps.sql", import.meta.url), "utf8"),
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      query("SELECT * FROM sweep_outbox"),
      /permission denied/,
    );
    await assert.rejects(
      query("SELECT approve_sweep_review($1,$2,'QA forbidden')", [
        next.id,
        actor,
      ]),
      /permission denied/,
    );
  } finally {
    await db.close();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
