import { test } from "node:test";
import assert from "node:assert/strict";
import { TronWeb } from "tronweb";
import { companyWalletAddress } from "../src/lib/company-wallet-address";

const address = TronWeb.address.fromPrivateKey("1".padStart(64,"0")) as string;
const other = TronWeb.address.fromPrivateKey("2".padStart(64,"0")) as string;
test("collection uses the stored wallet and rejects conflicting configuration", async () => {
  const oldNetwork=process.env.TRON_NETWORK, oldAddress=process.env.TRON_HOT_WALLET_ADDRESS;
  process.env.TRON_NETWORK="mainnet"; delete process.env.TRON_HOT_WALLET_ADDRESS;
  const db=(value: unknown)=>({query:async()=>({rows:value ? [value] : []})}) as any;
  try {
    assert.equal(await companyWalletAddress(db({address,network:"mainnet"})),address);
    process.env.TRON_HOT_WALLET_ADDRESS=address;
    assert.equal(await companyWalletAddress(db({address,network:"mainnet"})),address);
    assert.equal(await companyWalletAddress(db(null)),address);
    process.env.TRON_HOT_WALLET_ADDRESS=other;
    await assert.rejects(companyWalletAddress(db({address,network:"mainnet"})),/서로 다릅니다/);
    delete process.env.TRON_HOT_WALLET_ADDRESS;
    await assert.rejects(companyWalletAddress(db({address,network:"nile"})),/네트워크/);
  } finally { if(oldNetwork===undefined)delete process.env.TRON_NETWORK;else process.env.TRON_NETWORK=oldNetwork;if(oldAddress===undefined)delete process.env.TRON_HOT_WALLET_ADDRESS;else process.env.TRON_HOT_WALLET_ADDRESS=oldAddress; }
});
