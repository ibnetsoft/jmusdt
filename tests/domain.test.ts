import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsdt, formatUsdt } from "../src/lib/money";
import { isAuthorizedAdmin, canManageFunds } from "../src/lib/admin-access";
import { TronWeb } from "tronweb";
import { validTronAddress, MAINNET_USDT } from "../src/lib/tron";
import { decodeDeposits, TRANSFER_TOPIC } from "../src/lib/tron-transaction";
test("USDT arithmetic stays exact at 6 decimals", () => {
  assert.equal(parseUsdt("0.000001"), 1n);
  assert.equal(parseUsdt("999999999999.999999"), 999999999999999999n);
  assert.equal(formatUsdt(123456789n, 6), "123.456789");
  for (const bad of ["0", "-1", "1e6", "0.0000001", "NaN", "1.", ""])
    assert.throws(() => parseUsdt(bad));
});
test("admin access ignores user-editable metadata and denies by default", () => {
  assert.equal(isAuthorizedAdmin(null), false);
  assert.equal(isAuthorizedAdmin({ app_metadata: {} }), false);
  assert.equal(
    isAuthorizedAdmin({ app_metadata: { adminConsole: true } }),
    true,
  );
  assert.equal(canManageFunds({ app_metadata: { adminConsole: true } }), false);
  assert.equal(
    canManageFunds({ app_metadata: { adminRole: "SUPER_ADMIN" } }),
    true,
  );
});
test("TRON validates checksum, not just prefix", () => {
  assert.equal(validTronAddress(MAINNET_USDT), true);
  assert.equal(validTronAddress(MAINNET_USDT.slice(0, -1) + "1"), false);
  assert.equal(validTronAddress("0x1234"), false);
});
test("only successful official-contract Transfer logs are decoded", () => {
  const contractHex = TronWeb.address.toHex(MAINNET_USDT).slice(2);
  const topic = contractHex.padStart(64, "0");
  const info = {
    id: "tx",
    blockNumber: 100,
    blockTimeStamp: 123,
    receipt: { result: "SUCCESS" },
    log: [
      {
        address: contractHex,
        topics: [TRANSFER_TOPIC, topic, topic],
        data: 1000000n.toString(16).padStart(64, "0"),
      },
    ],
  };
  assert.equal(decodeDeposits(info, MAINNET_USDT)[0].amount, "1000000");
  assert.equal(decodeDeposits(info, MAINNET_USDT)[0].address, MAINNET_USDT);
  assert.equal(
    decodeDeposits({ ...info, receipt: { result: "REVERT" } }, MAINNET_USDT)
      .length,
    0,
  );
  assert.equal(
    decodeDeposits(
      { ...info, log: [{ ...info.log[0], address: "0".repeat(40) }] },
      MAINNET_USDT,
    ).length,
    0,
  );
});
