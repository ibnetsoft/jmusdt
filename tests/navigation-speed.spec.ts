import { test, expect } from "@playwright/test";

test("transfer and deposit screens open before a slow wallet refresh, without enabling unsafe actions", async ({ page }) => {
  let holdWallet = false;
  let releaseWallet = () => {};
  let waiting = Promise.resolve();
  const hold = () => { holdWallet = true; waiting = new Promise<void>(resolve => { releaseWallet = resolve; }); };
  const wallet = { mode: "live", user: { id: "test", name: "회원", email: "a@example.com", status: "active" }, available: "123000000", points: "0", reserved: "0", address: "TTESTADDRESS", network: "nile", fee: "1000000", minimum: "10000000", transactions: [] };
  await page.route("**/api/session", route => route.fulfill({ json: { userId: "test" } }));
  await page.route("**/api/wallet", async route => { if (holdWallet) await waiting; await route.fulfill({ json: wallet }); });
  await page.route(url => url.pathname === "/api/shop", route => route.fulfill({ json: { accountId: "test", products: [], orders: [], available: "0", marketing: { enabled: true, version: 1 } } }));
  await page.route("**/api/organization?**", route => route.fulfill({ json: { accountId: "test", viewer: "test", nodes: [], eligible: true, pending: [], truncated: false, pendingTruncated: false } }));
  await page.route("**/api/points", route => route.fulfill({ json: { accountId: "test", rate: 1300, rateVersion: 1, usdt: "0", points: "0", debt: "0", history: [] } }));
  await page.route("**/api/rewards", route => route.fulfill({ json: { accountId: "test", rewards: [], pools: [], packages: [] } }));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".balance-card")).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("wu-page-cache-v1") || "[]").some(([key]: [string]) => key === "/api/wallet"))).toBe(true);
    hold();
    await page.getByRole("button", { name: "이체", exact: true }).click();
    await expect(page.getByPlaceholder("name@example.com")).toBeVisible({ timeout: 1500 });
    await expect(page.getByRole("button", { name: "송금 정보 확인" })).toBeDisabled();
    holdWallet = false; releaseWallet();
    await expect(page.getByRole("button", { name: "송금 정보 확인" })).toBeEnabled();
    await page.getByRole("link", { name: "지갑", exact: true }).click();
    hold();
    await page.getByRole("button", { name: "입금", exact: true }).click();
    await expect(page.locator(".deposit-view")).toBeVisible({ timeout: 1500 });
    await expect(page.getByText("TTESTADDRESS")).toHaveCount(0);
    holdWallet = false; releaseWallet();
    await expect(page.getByText("TTESTADDRESS")).toBeVisible();
  } finally { holdWallet = false; releaseWallet(); }
});
