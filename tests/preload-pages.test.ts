import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheWalletData, clearPreloadedData, preloadPages, readPreloadedData } from "../src/lib/preload-pages";

test("preloaded pages are session-scoped and discarded after an account change", async () => {
  const originalFetch = globalThis.fetch; let account = "first"; const requests: string[] = [];
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  }});
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push(url); assert.equal(init?.cache, "no-store");
    if (url === "/api/session") return Response.json({ userId: account });
    return Response.json({ accountId: account, owner: account, url });
  }) as typeof fetch;
  try {
    clearPreloadedData(); await preloadPages();
    assert.ok(requests.includes("/api/shop?catalog=1")); assert.ok(requests.includes("/api/shop")); assert.ok(requests.includes("/api/organization?mode=sponsor&depth=3"));
    assert.ok(requests.includes("/api/organization?mode=referral&depth=3"));
    assert.ok(requests.includes("/api/points")); assert.ok(requests.includes("/api/rewards"));
    assert.ok(storage.has("wu-page-cache-v1"));
    assert.deepEqual(await readPreloadedData("/api/shop"), { accountId: "first", owner: "first", url: "/api/shop" });
    account = "second";
    assert.equal(await readPreloadedData("/api/shop"), null);
    assert.equal(await readPreloadedData("/api/rewards"), null);
    assert.equal(storage.has("wu-page-cache-v1"), false);
    await preloadPages();
    assert.deepEqual(await readPreloadedData("/api/shop"), { accountId: "second", owner: "second", url: "/api/shop" });
    clearPreloadedData(); assert.equal(await readPreloadedData("/api/shop"), null);
  } finally { clearPreloadedData(); globalThis.fetch = originalFetch; if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
});

test("wallet cache only exposes the verified account and ignores demo data", async () => {
  const originalFetch = globalThis.fetch;
  let account = "first";
  globalThis.fetch = (async () => Response.json({ userId: account })) as typeof fetch;
  try {
    clearPreloadedData();
    const wallet = { mode: "live", user: { id: "first" }, available: "100" };
    await cacheWalletData(wallet);
    assert.deepEqual(await readPreloadedData("/api/wallet"), wallet);
    await cacheWalletData({ mode: "demo", user: { id: "first" } });
    assert.deepEqual(await readPreloadedData("/api/wallet"), wallet);
    account = "second";
    assert.equal(await readPreloadedData("/api/wallet"), null);
  } finally { clearPreloadedData(); globalThis.fetch = originalFetch; }
});

test("shop and organization become available before a slow unrelated page", async () => {
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "/api/session") return Response.json({ userId: "first" });
    if (url === "/api/rewards") await slow;
    return Response.json({ accountId: "first", url });
  }) as typeof fetch;
  try {
    clearPreloadedData();
    const warming = preloadPages();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(await readPreloadedData("/api/shop?catalog=1"), { accountId: "first", url: "/api/shop?catalog=1" });
    assert.deepEqual(await readPreloadedData("/api/organization?mode=sponsor&depth=3"), { accountId: "first", url: "/api/organization?mode=sponsor&depth=3" });
    release(); await warming;
  } finally { release(); clearPreloadedData(); globalThis.fetch = originalFetch; }
});
