import { test, expect } from "@playwright/test";

test("mobile login switches to email recovery and returns to login without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: "비밀번호를 잊으셨나요?" }).click();
  await expect(
    page.getByRole("heading", { name: "비밀번호 찾기." }),
  ).toBeVisible();
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "재설정 메일 보내기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그인으로 돌아가기" }).click();
  await expect(
    page.getByRole("heading", { name: "다시 만나 반가워요." }),
  ).toBeVisible();
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBeFalsy();
});

test("reset without a recovery link cannot expose a password update form", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("status")).toContainText(
    "유효한 비밀번호 재설정 메일 링크",
  );
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toHaveCount(0);
});
