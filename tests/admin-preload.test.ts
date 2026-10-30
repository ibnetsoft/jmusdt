import test from "node:test";
import assert from "node:assert/strict";
import { clearAdminData, fetchAdminData, getAdminData } from "../src/lib/admin-preload";

test("administrator reads share requests and are cleared on authorization failure", async () => {
  clearAdminData();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ products: ["cached"] }), { status: 200 }); };
  try {
    const [first, second] = await Promise.all([fetchAdminData("/api/admin/products"), fetchAdminData("/api/admin/products")]);
    assert.equal(calls, 1);
    assert.deepEqual(await first.json(), await second.json());
    assert.deepEqual(getAdminData("/api/admin/products"), { products: ["cached"] });
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await fetchAdminData("/api/admin/orders?q=&status=all");
    assert.equal(getAdminData("/api/admin/products"), null);
  } finally { globalThis.fetch = original; clearAdminData(); }
});

test("a response started before a cache clear cannot repopulate it", async () => {
  clearAdminData();
  const original = globalThis.fetch;
  let finish!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>(resolve => { finish = resolve; });
  try {
    const request = fetchAdminData("/api/admin/products");
    clearAdminData();
    finish(new Response(JSON.stringify({ products: ["old account"] }), { status: 200 }));
    await request;
    assert.equal(getAdminData("/api/admin/products"), null);
  } finally { globalThis.fetch = original; clearAdminData(); }
});
