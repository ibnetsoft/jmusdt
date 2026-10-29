type Cached = { userId: string; value: unknown; expires: number };
const entries = new Map<string, Cached>();
const endpoints = ["/api/shop", "/api/organization?mode=sponsor&depth=3", "/api/points", "/api/rewards"];
let userId = "", generation = 0, lastWarm = 0;
let validation: Promise<{ id?: string; mode?: string } | null> | null = null;
async function currentAccount() {
  if (!validation) {
    validation = fetch("/api/wallet", { cache: "no-store" }).then(async response => {
      if (!response.ok) return null;
      const account = await response.json();
      return { id: account?.user?.id, mode: account?.mode };
    }).catch(() => null).finally(() => { validation = null; });
  }
  return validation;
}
export function clearPreloadedData() { generation++; userId = ""; lastWarm = 0; entries.clear(); }
export async function preloadPages() {
  try {
    const wallet = await fetch("/api/wallet", { cache: "no-store" });
    if (!wallet.ok) { clearPreloadedData(); return; }
    const account = await wallet.json();
    const id = account?.user?.id;
    if (typeof id !== "string" || account.mode === "demo") { clearPreloadedData(); return; }
    if (userId !== id) { clearPreloadedData(); userId = id; }
    if (Date.now() - lastWarm < 30000) return;
    lastWarm = Date.now(); const current = generation;
    const results = await Promise.allSettled(endpoints.map(async endpoint => {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) return null;
      return { endpoint, value: await response.json() as unknown };
    }));
    const verified = await fetch("/api/wallet", { cache: "no-store" });
    if (!verified.ok) { if (current === generation) clearPreloadedData(); return; }
    const confirmed = await verified.json();
    if (current !== generation || userId !== id) return;
    if (confirmed?.user?.id !== id || confirmed.mode === "demo") { clearPreloadedData(); return; }
    for (const result of results) if (result.status === "fulfilled" && result.value)
      entries.set(result.value.endpoint, { userId: id, value: result.value.value, expires: Date.now() + 30000 });
  } catch { /* Prefetch is optional; each page still loads directly. */ }
}
export async function readPreloadedData<T>(endpoint: string): Promise<T | null> {
  const entry = entries.get(endpoint);
  if (!entry || entry.expires < Date.now()) return null;
  try {
    const account = await currentAccount();
    if (!account || account.id !== entry.userId || account.mode === "demo") { clearPreloadedData(); return null; }
    if (entries.get(endpoint) !== entry || entry.expires < Date.now()) return null;
    return entry.value as T;
  } catch { return null; }
}
