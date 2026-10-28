import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  const response = await request.get("/api/wallet");
  expect(response.ok(), "UI tests must run against a demo server").toBeTruthy();
  expect((await response.json()).mode).toBe("demo");
});
test("mobile wallet internal transfer updates balance and admin sees the same ledger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("12,840.50", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "송금하기", exact: true })
    .first()
    .click();
  await page.getByPlaceholder("name@example.com").fill("min@example.com");
  await page.getByLabel("송금 금액").fill("20");
  await page.getByRole("button", { name: "송금 정보 확인" }).click();
  await page
    .getByRole("button", { name: "송금하기", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "송금 완료." })).toBeVisible();
  await page.getByRole("button", { name: "내 지갑으로 돌아가기" }).click();
  await expect(page.getByText("12,820.50", { exact: false })).toBeVisible();
  await page.goto("/admin");
  await page.getByRole("button", { name: "회원 관리", exact: true }).click();
  await expect(page.getByText("12,820.50 USDT")).toBeVisible();
  await expect(page.getByText("4,280.00 USDT")).toBeVisible();
});
test("admin rejection returns reservation to user; double processing is absent", async ({
  page,
}) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: "반려", exact: true }).click();
  await page
    .getByPlaceholder("확인한 내용 또는 처리 사유")
    .fill("주소 확인 후 반려");
  await page.getByRole("button", { name: "출금 반려", exact: true }).click();
  await expect(page.getByText("출금 반려 처리했습니다.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("13,090.50", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "거래 내역", exact: true })
    .last()
    .click();
  await expect(page.getByText("반려", { exact: false })).toBeVisible();
});
test("deposit demo is unmistakable, transaction dialog and PWA metadata work", async ({
  page,
  request,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "입금하기", exact: true }).click();
  await expect(page.getByText("DEMO · 입금 불가")).toBeVisible();
  await page.getByRole("button", { name: "전용 입금 주소 생성" }).click();
  await expect(page.getByRole("status")).toContainText("실제 계정을 연결");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBeFalsy();
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
  const response = await request.post("/api/wallet/send", {
    headers: { Origin: baseURL! },
    data: {
      kind: "internal",
      recipient: "min@example.com",
      amount: "1",
      key: crypto.randomUUID(),
    },
  });
  expect(response.status()).toBe(403);
  const crossSite = await request.post("/api/admin/action", {
    headers: { Origin: "https://evil.example" },
    data: {},
  });
  expect(crossSite.status()).toBe(403);
});
test("desktop wallet and admin fit their viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("Less friction.")).toBeVisible();
  await page.screenshot({
    path: "artifacts/wallet-desktop.png",
    fullPage: true,
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "대시보드", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBeFalsy();
  await page.screenshot({
    path: "artifacts/admin-desktop.png",
    fullPage: true,
  });
});
