import { TronWeb } from "tronweb";
import { getTronGridKey } from "./tron-api-settings";
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
export async function tronClient() {
  const { host } = chainConfig();
  const apiKey = await getTronGridKey();
  return new TronWeb({
    fullHost: host,
    headers: apiKey
      ? { "TRON-PRO-API-KEY": apiKey }
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
  if (!url || !token) {
    if (process.env.INTERNAL_CUSTODY_ENABLED !== "true") throw new Error("Custody service not configured");
    const internal = await import("./internal-custody");
    const input = body as { index?: string; kind?: string; id?: string; transaction?: import("tronweb").Types.Transaction; network?: string };
    if (input.network !== chainConfig().network) throw new Error("Custody network mismatch");
    if (path === "/addresses" && typeof input.index === "string") return await internal.internalAddress(input.index) as T;
    if (path === "/sign" && input.kind && input.id && input.transaction) return await internal.internalSignSweep(input.kind,input.id,input.transaction) as T;
    throw new Error("Unsupported internal custody operation");
  }
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
