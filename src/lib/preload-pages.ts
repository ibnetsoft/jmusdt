type Cached = { userId: string; value: unknown; expires: number };
type Account = { id: string } | { invalid: true } | null;
const entries = new Map<string, Cached>();
const inFlight = new Map<string, Promise<void>>();
const endpoints = ["/api/shop?catalog=1", "/api/organization?mode=sponsor&depth=3", "/api/organization?mode=referral&depth=3", "/api/points", "/api/rewards", "/api/shop"];
const storageKey = "wu-page-cache-v1";
const cacheLifetime = 30 * 60 * 1000;
let restored = false;
function restoreEntries() {
  if (restored) return;
  restored = true;
  try {
    if (typeof sessionStorage === "undefined") return;
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return;
    for (const pair of saved) {
      if (!Array.isArray(pair) || pair.length !== 2 || !endpoints.includes(pair[0])) continue;
      const entry = pair[1];
      if (entry && typeof entry.userId === "string" && typeof entry.expires === "number" && entry.expires > Date.now() && entry.expires <= Date.now() + cacheLifetime && entry.value && typeof entry.value === "object") entries.set(pair[0], entry);
    }
  } catch { /* Storage may be unavailable; live requests remain available. */ }
}
function persistEntries() {
  try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, JSON.stringify([...entries])); }
  catch { /* Storage is optional and may be full or disabled. */ }
}
let userId = "", generation = 0, lastWarm = 0;
let validation: Promise<Account> | null = null, warming: Promise<void> | null = null, scheduling: Promise<void> | null = null;
async function currentAccount(): Promise<Account> {
  if (!validation) {
    validation = fetch("/api/session", { cache: "no-store" }).then(async response => {
      if (response.status === 401 || response.status === 403) return { invalid: true } as const;
      if (!response.ok) return null;
      const account = await response.json();
      return typeof account?.userId === "string" ? { id: account.userId as string } : null;
    }).catch(() => null).finally(() => { validation = null; });
  }
  return validation;
}
export function clearPreloadedData() {
  generation++; userId = ""; lastWarm = 0; entries.clear(); inFlight.clear(); warming = null; scheduling = null; restored = true;
  try { if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey); } catch { /* Ignore unavailable storage. */ }
}
export function preloadPages(): Promise<void> {
  if (warming) return warming;
  const started = generation;
  let ready!: () => void;
  const scheduled = new Promise<void>(resolve => { ready = resolve; });
  scheduling = scheduled;
  const task = (async () => {
    try {
      const account = await currentAccount();
      if (started !== generation || !account) return;
      if ("invalid" in account) { clearPreloadedData(); return; }
      const id = account.id;
      restoreEntries();
      if (userId && userId !== id) clearPreloadedData();
      userId = id;
      let removedOtherAccount = false;
      for (const [endpoint, entry] of entries) if (entry.userId !== id) { entries.delete(endpoint); removedOtherAccount = true; }
      if (removedOtherAccount) persistEntries();
      if (Date.now() - lastWarm < 30000) return;
      lastWarm = Date.now(); const current = generation;
      const remaining = [...endpoints];
      const worker = async () => {
        while (remaining.length && current === generation) {
          const endpoint = remaining.shift()!;
          const request = (async () => {
            try {
              const response = await fetch(endpoint, { cache: "no-store" });
              if (!response.ok) return;
              const value = await response.json();
              // The endpoint identifies the account that produced its response.
              if (current === generation && userId === id && value?.accountId === id) {
                entries.set(endpoint, { userId: id, value, expires: Date.now() + cacheLifetime });
                persistEntries();
              }
            } catch { /* Individual pages still load directly on navigation. */ }
          })();
          inFlight.set(endpoint, request);
          await request;
          if (inFlight.get(endpoint) === request) inFlight.delete(endpoint);
        }
      };
      const workers = [worker(), worker(), worker()];
      ready();
      await Promise.all(workers);
    } catch { /* Prefetch is optional; each page still loads directly. */ }
    finally { ready(); if (scheduling === scheduled) scheduling = null; }
  })();
  warming = task;
  void task.finally(() => { if (warming === task) warming = null; });
  return task;
}
export async function readPreloadedData<T>(endpoint: string): Promise<T | null> {
  restoreEntries();
  const started = generation;
  let entry = entries.get(endpoint);
  if ((!entry || entry.expires < Date.now()) && scheduling) {
    await scheduling;
    const request = inFlight.get(endpoint);
    if (request) await request;
    if (started !== generation) return null;
    entry = entries.get(endpoint);
  }
  if (!entry || entry.expires < Date.now()) return null;
  const account = await currentAccount();
  if (started !== generation || !account) return null;
  if ("invalid" in account || account.id !== entry.userId) { clearPreloadedData(); return null; }
  if (entries.get(endpoint) !== entry || entry.expires < Date.now()) return null;
  return entry.value as T;
}
