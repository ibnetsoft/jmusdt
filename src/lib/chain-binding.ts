import { database } from "./db";
import { chainConfig, validTronAddress } from "./tron";
// A database belongs to exactly one network/token. Switching env vars must not
// reinterpret pending withdrawals or historical balances on another chain.
export async function verifyExistingChainBinding() {
  const { network, contract } = chainConfig();
  const row = (
    await database().query(
      "SELECT network,contract FROM wallet_configuration WHERE id=true",
    )
  ).rows[0];
  if (
    row &&
    (row.network !== network || (contract && row.contract !== contract))
  )
    throw new Error("Database network/token binding mismatch");
}
export async function ensureChainBinding() {
  const { network, contract } = chainConfig();
  if (!contract || !validTronAddress(contract))
    throw new Error("USDT contract configuration required");
  const row = (
    await database().query(
      "INSERT INTO wallet_configuration(id,network,contract) VALUES(true,$1,$2) ON CONFLICT(id) DO UPDATE SET id=true RETURNING *",
      [network, contract],
    )
  ).rows[0];
  if (row.network !== network || row.contract !== contract)
    throw new Error(
      "Database network/token binding mismatch. Use a separate database for each network.",
    );
}
