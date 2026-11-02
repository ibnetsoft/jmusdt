import { test, expect } from "@playwright/test";

test("notifications show localized notices and return to the prior wallet screen", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.route("**/api/session", r => r.fulfill({json:{userId:"test"}}));
  await page.route("**/api/wallet", r => r.fulfill({json:{mode:"live",user:{id:"test",name:"회원",email:"test@example.com",status:"active"},available:"0",points:"0",reserved:"0",address:"TTESTADDRESS",network:"nile",fee:"1000000",minimum:"10000000",transactions:[]}}));
  await page.route("**/api/notifications?**", r => {
    const language = new URL(r.request().url()).searchParams.get("lang");
    return r.fulfill({json:{accountId:"test",notifications:[{id:"1",title:language === "en" ? "English notice" : "한국어 공지",body:"본문",created_at:"2026-11-01T00:00:00Z"}]}});
  });
  await page.goto("/");
  await page.getByRole("button",{name:"입금",exact:true}).click();
  await expect(page.locator(".deposit-view")).toBeVisible();
  await page.getByRole("link",{name:"알림",exact:true}).click();
  await expect(page.getByText("한국어 공지")).toBeVisible();
  await page.getByRole("button",{name:"뒤로 가기"}).click({position:{x:38,y:20}});
  await expect(page.locator(".deposit-view")).toBeVisible();
  await page.goto("/mypage");
  await page.getByRole("button",{name:"English",exact:true}).click();
  await page.getByRole("link",{name:"Notifications",exact:true}).click();
  await expect(page.getByText("English notice")).toBeVisible();
});

