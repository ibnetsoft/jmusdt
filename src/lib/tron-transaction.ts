import { TronWeb, Trx, utils, type Types } from "tronweb";
export type Unsigned = Types.Transaction<Types.TriggerSmartContract>;
export type Signed = Types.SignedTransaction<Types.TriggerSmartContract>;
export function transferCalldata(to: string, amount: string) {
  return (
    "a9059cbb" +
    TronWeb.address.toHex(to).slice(2).padStart(64, "0") +
    BigInt(amount).toString(16).padStart(64, "0")
  );
}
export function validateTransfer(
  tx: Unsigned,
  expected: {
    owner: string;
    contract: string;
    to: string;
    amount: string;
    feeLimit: number;
  },
) {
  if (!utils.transaction.txCheck(tx))
    throw new Error("Transaction protobuf mismatch");
  const calculated = utils.transaction
    .txPbToTxID(utils.transaction.txJsonToPb(tx))
    .replace(/^0x/, "");
  if (calculated.toLowerCase() !== tx.txID.toLowerCase())
    throw new Error("Transaction ID mismatch");
  const calls = tx.raw_data.contract;
  if (
    calls.length !== 1 ||
    calls[0].type !== "TriggerSmartContract" ||
    calls[0].Permission_id
  )
    throw new Error("Unexpected contract operation");
  const call = calls[0].parameter.value;
  const hex = (address: string) => TronWeb.address.toHex(address).toLowerCase();
  if (
    hex(call.owner_address) !== hex(expected.owner) ||
    hex(call.contract_address) !== hex(expected.contract) ||
    call.data?.toLowerCase() !==
      transferCalldata(expected.to, expected.amount) ||
    call.call_value ||
    call.call_token_value ||
    call.token_id
  )
    throw new Error("Unexpected transfer payload");
  if (Number(tx.raw_data.fee_limit) !== expected.feeLimit || tx.raw_data.data)
    throw new Error("Unexpected fee or memo");
  if (
    !Number.isSafeInteger(tx.raw_data.expiration) ||
    !Number.isSafeInteger(tx.raw_data.timestamp) ||
    tx.raw_data.expiration - tx.raw_data.timestamp > 3600000
  )
    throw new Error("Invalid transaction expiration");
}
export function validateSigned(unsigned: Unsigned, signed: Signed) {
  if (
    JSON.stringify(unsigned.raw_data) !== JSON.stringify(signed.raw_data) ||
    unsigned.raw_data_hex !== signed.raw_data_hex ||
    unsigned.txID !== signed.txID ||
    !Array.isArray(signed.signature) ||
    signed.signature.length !== 1 ||
    !/^[a-fA-F0-9]{130}$/.test(signed.signature[0])
  )
    throw new Error("Custody modified transaction");
  const recovered = Trx.ecRecover(signed);
  if (
    Array.isArray(recovered) ||
    recovered !==
      TronWeb.address.fromHex(
        unsigned.raw_data.contract[0].parameter.value.owner_address,
      )
  )
    throw new Error("Wrong custody signing key");
}
export const TRANSFER_TOPIC =
  "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export type Receipt = {
  id: string;
  blockNumber: number;
  blockTimeStamp: number;
  result?: string;
  receipt?: { result?: string };
  log?: { address: string; topics: string[]; data: string }[];
};
export function decodeDeposits(info: Receipt, contract: string) {
  if (info.result === "FAILED" || info.receipt?.result !== "SUCCESS") return [];
  return (info.log || []).flatMap((log, index) => {
    const logAddress =
      log.address.length === 42 ? log.address.slice(2) : log.address;
    if (
      logAddress.toLowerCase() !==
        TronWeb.address.toHex(contract).slice(2).toLowerCase() ||
      log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      log.topics.length !== 3
    )
      return [];
    if (
      !/^[a-f0-9]{64}$/i.test(log.data) ||
      !log.topics.slice(1).every((topic) => /^[a-f0-9]{64}$/i.test(topic))
    )
      throw new Error("Malformed USDT Transfer event");
    const amount = BigInt("0x" + log.data);
    if (amount === 0n) return [];
    return [
      {
        index,
        address: TronWeb.address.fromHex("41" + log.topics[2].slice(-40)),
        amount: amount.toString(),
      },
    ];
  });
}
