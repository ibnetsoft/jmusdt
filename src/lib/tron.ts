import { TronWeb } from "tronweb";
export const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export function chainConfig() {
  const network = process.env.TRON_NETWORK || "nile";
  if (!["nile", "mainnet"].includes(network))
    throw new Error("Unsupported TRON network");
  const contract =
    network === "mainnet" ? MAINNET_USDT : process.env.TRON_USDT_CONTRACT;
  return {
    network,
    contract,
    host:
      network === "mainnet"
        ? "https://api.trongrid.io"
        : "https://nile.trongrid.io",
  };
}
export function tronClient() {
  const { host } = chainConfig();
  return new TronWeb({
    fullHost: host,
    headers: process.env.TRONGRID_API_KEY
      ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
      : {},
  });
}
export function validTronAddress(address: string) {
  return (
    /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) && TronWeb.isAddress(address)
  );
}
export async function custody<T>(path: string, body: unknown): Promise<T> {
  const url = process.env.CUSTODY_URL,
    token = process.env.CUSTODY_TOKEN;
  if (!url || !token) throw new Error("Custody service not configured");
  if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1:"))
    throw new Error("Custody must use HTTPS");
  const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Custody request failed");
  return response.json() as Promise<T>;
}
