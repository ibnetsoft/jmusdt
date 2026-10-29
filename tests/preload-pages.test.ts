import { test } from "node:test";
import assert from "node:assert/strict";
import { clearPreloadedData, preloadPages, readPreloadedData } from "../src/lib/preload-pages";

test("preloaded pages are memory-only, account-scoped and discarded after a session change", async () => {
  const originalFetch = globalThis.fetch; let account = "first"; const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push(url); assert.equal(init?.cache, "no-store");
    if (url === "/api/wallet") return Response.json({ user: { id: account }, mode: "live" });
    return Response.json({ owner: account, url });
  }) as typeof fetch;
  try {
    clearPreloadedData(); await preloadPages();
    assert.ok(requests.includes("/api/shop")); assert.ok(requests.includes("/api/organization?mode=sponsor&depth=3"));
    assert.ok(requests.includes("/api/points")); assert.ok(requests.includes("/api/rewards"));
    assert.deepEqual(await readPreloadedData("/api/shop"), { owner: "first", url: "/api/shop" });
    account = "second";
    assert.equal(await readPreloadedData("/api/shop"), null);
    assert.equal(await readPreloadedData("/api/rewards"), null);
    await preloadPages();
    assert.deepEqual(await readPreloadedData("/api/shop"), { owner: "second", url: "/api/shop" });
    clearPreloadedData(); assert.equal(await readPreloadedData("/api/shop"), null);
  } finally { clearPreloadedData(); globalThis.fetch = originalFetch; }
});
