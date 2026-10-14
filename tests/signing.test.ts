import { test } from "node:test";
import assert from "node:assert/strict";
import { TronWeb, utils, Types } from "tronweb";
import { MAINNET_USDT } from "../src/lib/tron";
import {
  validateTransfer,
  validateSigned,
  transferCalldata,
  type Unsigned,
} from "../src/lib/tron-transaction";
// Public, disposable deterministic keys for offline signing tests only.
const key = "1".padStart(64, "0"),
  otherKey = "2".padStart(64, "0");
function fixture() {
  const owner = TronWeb.address.fromPrivateKey(key) as string,
    to = TronWeb.address.fromPrivateKey(otherKey) as string;
  const tx: Unsigned = {
    visible: false,
    txID: "",
    raw_data_hex: "",
    raw_data: {
      ref_block_bytes: "abcd",
      ref_block_hash: "0123456789abcdef",
      timestamp: 1700000000000,
      expiration: 1700000060000,
      fee_limit: 100000000,
      contract: [
        {
          type: Types.ContractType.TriggerSmartContract,
          parameter: {
            type_url: "type.googleapis.com/protocol.TriggerSmartContract",
            value: {
              owner_address: TronWeb.address.toHex(owner),
              contract_address: TronWeb.address.toHex(MAINNET_USDT),
              call_value: 0,
              data: transferCalldata(to, "1000000"),
            },
          },
        },
      ],
    },
  };
  const pb = utils.transaction.txJsonToPb(tx);
  tx.raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase();
  tx.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, "").toLowerCase();
  return {
    tx,
    expected: {
      owner,
      to,
      contract: MAINNET_USDT,
      amount: "1000000",
      feeLimit: 100000000,
    },
  };
}
test("offline unsigned transfer verifies protobuf, amount, receiver and fee limit", () => {
  const { tx, expected } = fixture();
  validateTransfer(tx, expected);
  assert.throws(
    () => validateTransfer(tx, { ...expected, amount: "2000000" }),
    /Unexpected transfer/,
  );
  assert.throws(
    () => validateTransfer(tx, { ...expected, feeLimit: 200000000 }),
    /Unexpected fee/,
  );
  const changed = structuredClone(tx);
  changed.raw_data.contract[0].parameter.value.data = transferCalldata(
    expected.to,
    "2",
  );
  assert.throws(() => validateTransfer(changed, expected), /protobuf mismatch/);
});
test("offline custody signature must recover the expected owner and preserve payload", async () => {
  const { tx } = fixture();
  const tron = new TronWeb({ fullHost: "https://nile.trongrid.io" });
  const signed = await tron.trx.sign(tx, key);
  validateSigned(tx, signed);
  const changed = structuredClone(signed);
  changed.raw_data.expiration++;
  assert.throws(() => validateSigned(tx, changed), /modified transaction/);
  const wrong = structuredClone(tx);
  wrong.raw_data.contract[0].parameter.value.owner_address =
    TronWeb.address.toHex(TronWeb.address.fromPrivateKey(otherKey) as string);
  const pb = utils.transaction.txJsonToPb(wrong);
  wrong.raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase();
  wrong.txID = utils.transaction
    .txPbToTxID(pb)
    .replace(/^0x/, "")
    .toLowerCase();
  const wrongSigned = await tron.trx.sign(wrong, otherKey);
  const forged = structuredClone(signed);
  forged.signature = wrongSigned.signature;
  assert.throws(() => validateSigned(tx, forged));
});
