import { test, expect } from "@playwright/test";

test("member pricing displays the consumer comparison and requires shipping before purchase", async ({ page }) => {
  const product = {
    id: "ac16621b-1535-4379-8f1a-927084e4ab46", name: "척척보감", description: "",
    image_url: "", detail_blocks: [], price: "88000000000", retail_price: "98000000000",
    stock: 100, active: true, version: 1, shipping_type: "physical", package_type: "none",
    reward_plan: { referral: "9000000000", sponsor: "4500000000", mom: "4500000000", daily: "0", days: 0, lucky: 3000, treasure: 3000 },
  };
  await page.route("**/api/shop", route => route.fulfill({ json: { products: [product], orders: [], available: "100000000000", marketing: { enabled: true, daily_paused: false, version: 1 } } }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/shop");
  await expect(page.getByText("소비자가 98,000 P", { exact: true })).toBeVisible();
  await expect(page.getByText("회원가 88,000 P", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "상품 상세 보기" }).click();
  await expect(page.locator(".shop-total")).toHaveText("결제금액 88,000.000000 포인트");
  await expect(page.getByText(/상품 1개당 데일리/)).toHaveCount(0);
  await expect(page.getByText(/회사 적립: 복주머니P 3000 P · 보물상자P 3000 P/)).toBeVisible();
  const confirm = page.getByRole("button", { name: "88,000.000000 포인트 결제 확정", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("받는 분", { exact: true }).fill("홍길동");
  await page.getByLabel("연락처", { exact: true }).fill("010-0000-0000");
  await page.getByLabel("배송 주소", { exact: true }).fill("서울시 테스트 주소");
  await expect(confirm).toBeEnabled();
  await page.getByRole("combobox", { name: "수량", exact: true }).selectOption("2");
  await expect(page.locator(".shop-total")).toHaveText("결제금액 176,000.000000 포인트");
  await expect(page.getByRole("button", { name: "포인트 잔액 부족", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("회원가 88,000 P", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
