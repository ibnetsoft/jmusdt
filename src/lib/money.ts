export const SCALE = 1_000_000n;
export function parseUsdt(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value))
    throw new Error("금액은 소수점 6자리까지 입력해 주세요.");
  const [whole, decimal = ""] = value.split(".");
  const amount = BigInt(whole) * SCALE + BigInt(decimal.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("0보다 큰 금액을 입력해 주세요.");
  return amount;
}
export function formatUsdt(units: string | bigint, places = 2) {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / SCALE)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % SCALE)
    .toString()
    .padStart(6, "0")
    .slice(0, places);
  return `${negative ? "-" : ""}${whole}${places ? "." + fraction : ""}`;
}
export function decimalUsdt(units: bigint) {
  return `${units / SCALE}.${(units % SCALE).toString().padStart(6, "0")}`;
}
