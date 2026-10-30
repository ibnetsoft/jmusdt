import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheWalletData, clearPreloadedData, fetchPageData, getPreloadedShopProducts, getVerifiedPageData, preloadPages, readPreloadedData, subscribePreloadedShopProducts } from "../src/lib/preload-pages";
import { preloadProductImages, productImageSizes } from "../src/lib/shop-images";

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

test("verified product list is immediately available without an additional request and is cleared on logout", async () => {
  const originalFetch = globalThis.fetch; let calls = 0, notifications = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls++;
    if (String(input) === "/api/session") return Response.json({ userId: "first" });
    return Response.json({ accountId: "first", products: [{ id: "p", name: "상품" }], available: "999" });
  }) as typeof fetch;
  const unsubscribe = subscribePreloadedShopProducts(() => { notifications++; });
  try {
    clearPreloadedData(); await preloadPages();
    const before = calls;
    assert.deepEqual(getPreloadedShopProducts(), [{ id: "p", name: "상품" }]);
    assert.equal(calls, before);
    assert.ok(notifications > 0);
    clearPreloadedData();
    assert.equal(getPreloadedShopProducts(), null);
  } finally { unsubscribe(); clearPreloadedData(); globalThis.fetch = originalFetch; }
});

test("wallet, organization and history snapshots are immediately available only for the verified session", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls++; const url = String(input);
    if (url === "/api/session") return Response.json({ userId: "first" });
    if (url === "/api/wallet") return Response.json({ mode: "live", user: { id: "first" }, available: "100" });
    return Response.json({ accountId: "first", url });
  }) as typeof fetch;
  try {
    clearPreloadedData(); await preloadPages();
    const before = calls;
    assert.equal(getVerifiedPageData<{available: string}>("/api/wallet")?.available, "100");
    assert.equal(getVerifiedPageData<{url: string}>("/api/organization?mode=sponsor&depth=3")?.url, "/api/organization?mode=sponsor&depth=3");
    assert.equal(getVerifiedPageData<{url: string}>("/api/rewards")?.url, "/api/rewards");
    assert.equal(calls, before);
    clearPreloadedData();
    assert.equal(getVerifiedPageData("/api/wallet"), null);
    assert.equal(getVerifiedPageData("/api/rewards"), null);
  } finally { clearPreloadedData(); globalThis.fetch = originalFetch; }
});

test("concurrent page requests share one fetch without sharing response bodies or cancellation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0, release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => { calls++; await wait; return Response.json({ value: 1 }); }) as typeof fetch;
  try {
    clearPreloadedData();
    const controller = new AbortController();
    const cancelled = fetchPageData("/api/shop?catalog=1", controller.signal);
    const first = fetchPageData("/api/shop?catalog=1");
    const second = fetchPageData("/api/shop?catalog=1");
    controller.abort(); release();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.deepEqual(await (await first).json(), { value: 1 });
    assert.deepEqual(await (await second).json(), { value: 1 });
    assert.equal(calls, 1);
    await fetchPageData("/api/shop?catalog=1");
    assert.equal(calls, 2);
  } finally { release(); clearPreloadedData(); globalThis.fetch = originalFetch; }
});

test("product images are prepared with the same responsive source as the shop", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const images: { src: string; srcset: string; sizes: string; referrerPolicy: string }[] = [];
  class FakeImage {
    src = ""; srcset = ""; sizes = ""; referrerPolicy = "";
    constructor() { images.push(this); }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { Image: FakeImage } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  Object.defineProperty(process.env, "NODE_ENV", { configurable: true, writable: true, enumerable: true, value: "production" });
  try {
    const managed = "https://example.supabase.co/storage/v1/object/public/product-images/a.webp";
    preloadProductImages([{ image_url: managed }, { image_url: managed }, { image_url: "https://other.example/item.webp" }, { image_url: "javascript:bad" }]);
    assert.equal(images.length, 2);
    assert.equal(images[0].sizes, productImageSizes);
    assert.match(images[0].srcset, /_next\/image\?/);
    assert.equal(images[1].src, "https://other.example/item.webp");
    assert.equal(images[1].referrerPolicy, "no-referrer");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalOrigin;
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.defineProperty(process.env, "NODE_ENV", { configurable: true, writable: true, enumerable: true, value: originalNodeEnv });
  }
});
