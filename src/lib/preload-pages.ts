import { clearAdminData } from "./admin-preload";
import { preloadProductImages } from "./shop-images";
type Cached = { userId: string; value: unknown; expires: number };
type Account = { id: string } | { invalid: true } | null;
const entries = new Map<string, Cached>();
const inFlight = new Map<string, Promise<void>>();
const sharedRequests = new Map<string, Promise<Response>>();
const dataListeners = new Set<() => void>();
let authGeneration = 0;
export function getAuthGeneration() { return authGeneration; }
export function subscribeVerifiedPageData(listener: () => void) { dataListeners.add(listener); return () => { dataListeners.delete(listener); }; }
export const authChangeKey = "wu-auth-change";
export function notifyAuthChange() { try { localStorage.setItem(authChangeKey, crypto.randomUUID()); } catch { /* Other tabs will revalidate on the next refresh. */ } }
function notifyData() { for (const listener of dataListeners) listener(); }
export function getVerifiedPageData<T>(endpoint: string): T | null {
  const entry = entries.get(endpoint);
  return userId && entry && entry.userId === userId && entry.expires > Date.now() ? entry.value as T : null;
}
let shopProducts: unknown[] | null = null;
const shopListeners = new Set<() => void>();
export function getPreloadedShopProducts<T>(): T[] | null { return shopProducts as T[] | null; }
export function subscribePreloadedShopProducts(listener: () => void) { shopListeners.add(listener); return () => { shopListeners.delete(listener); }; }
function publishShopProducts(value: unknown) {
  shopProducts = Array.isArray(value) ? value : null;
  for (const listener of shopListeners) listener();
}
const endpoints = ["/api/wallet", "/api/shop?catalog=1", "/api/organization?mode=sponsor&depth=3", "/api/organization?mode=referral&depth=3", "/api/points", "/api/rewards", "/api/shop"];
const cacheableEndpoints = endpoints;
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
      if (!Array.isArray(pair) || pair.length !== 2 || !cacheableEndpoints.includes(pair[0])) continue;
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
    const request = fetch("/api/session", { cache: "no-store" }).then(async response => {
      if (response.status === 401 || response.status === 403) return { invalid: true } as const;
      if (!response.ok) return null;
      const account = await response.json();
      return typeof account?.userId === "string" ? { id: account.userId as string } : null;
    }).catch(() => null);
    validation = request;
    void request.finally(() => { if (validation === request) validation = null; });
  }
  return validation;
}
export function clearPreloadedData(options?: { preserveShopProducts?: boolean }) {
  if (!options?.preserveShopProducts) clearAdminData();
  generation++; userId = ""; lastWarm = 0; entries.clear(); inFlight.clear(); sharedRequests.clear(); validation = null; warming = null; scheduling = null; restored = true;
  if (!options?.preserveShopProducts) { authGeneration++; publishShopProducts(null); }
  notifyData();
  try { if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey); } catch { /* Ignore unavailable storage. */ }
  if (options?.preserveShopProducts) void preloadPages();
}
// Share only concurrent reads. Each consumer receives its own response body and
// can abandon its result without cancelling requests needed by other screens.
export async function fetchPageData(endpoint: string, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let request = sharedRequests.get(endpoint);
  if (!request) {
    request = fetch(endpoint, { cache: "no-store" });
    sharedRequests.set(endpoint, request);
    const active = request;
    void request.finally(() => { if (sharedRequests.get(endpoint) === active) sharedRequests.delete(endpoint); }).catch(() => {});
  }
  const response = await request;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return response.clone();
}
export async function cacheWalletData(value: { mode: string; user: { id: string } }) {
  if (value.mode !== "live") return;
  const started = generation;
  const account = await currentAccount();
  if (started !== generation || !account || "invalid" in account || account.id !== value.user.id) return;
  restoreEntries();
  entries.set("/api/wallet", { userId: account.id, value, expires: Date.now() + cacheLifetime });
  persistEntries();
  notifyData();
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
      notifyData();
      const catalog = entries.get("/api/shop?catalog=1");
      if (catalog?.userId === id && catalog.expires > Date.now()) {
        const products = (catalog.value as { products?: unknown }).products;
        publishShopProducts(products); preloadProductImages(products);
      }
      if (Date.now() - lastWarm < 30000) return;
      lastWarm = Date.now(); const current = generation;
      const remaining = [...endpoints];
      const worker = async () => {
        while (remaining.length && current === generation) {
          const endpoint = remaining.shift()!;
          const request = (async () => {
            try {
              const response = await fetchPageData(endpoint);
              if (!response.ok) return;
              const value = await response.json();
              // The endpoint identifies the account that produced its response.
              const responseId = endpoint === "/api/wallet" ? value?.user?.id : value?.accountId;
              if (current === generation && userId === id && responseId === id) {
                entries.set(endpoint, { userId: id, value, expires: Date.now() + cacheLifetime });
                persistEntries();
                notifyData();
                if (endpoint === "/api/shop?catalog=1") { publishShopProducts(value.products); preloadProductImages(value.products); }
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
