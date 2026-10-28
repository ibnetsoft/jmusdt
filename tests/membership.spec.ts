import {test,expect} from "@playwright/test";
import {demoWallet} from "../src/lib/demo";

test("mobile mypage shows regular membership and copies the automatic referral link into signup",async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await page.route("**/api/wallet",route=>route.fulfill({json:{...demoWallet,mode:"live",user:{...demoWallet.user,gradeName:"정회원"},referralCode:"ABCDEF123456"}}));
  await page.goto("/mypage");
  await expect(page.getByRole("heading",{name:"마이페이지",exact:true})).toBeVisible();
  await expect(page.getByText("회원등급: 정회원")).toBeVisible();
  await expect(page.getByLabel("자동 생성된 추천코드")).toHaveValue("ABCDEF123456");
  const invite=new URL(page.url()).origin+"/login?ref=ABCDEF123456";
  await expect(page.getByLabel("추천 가입 링크")).toHaveValue(invite);
  await page.getByRole("button",{name:"추천링크 복사",exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(invite);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:"artifacts/mypage-mobile.png",fullPage:true});
  await page.goto(invite);
  await expect(page.getByLabel("추천 코드 (선택)")).toHaveValue("ABCDEF123456");
});

test("sponsor tree renders all automatic children and waiting reasons without manual slots",async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  const root="00000000-0000-4000-8000-000000000001";
  const node={created_at:"2026-10-28T01:00:00Z",status:"active",has_children:false,sales:"50000000000",rollup_generation:0};
  await page.route("**/api/organization?*",route=>route.fulfill({json:{viewer:root,code:"ABCDEF123456",eligible:true,truncated:false,pendingTruncated:false,
    nodes:[{...node,id:root,name:"내 조직",code:"ABCDEF123456",parent_id:null,depth:0,referral_ordinal:null},
      ...[1,2,4,5].map(i=>({...node,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,name:`정회원 ${i}`,code:`MEMBER00000${i}`,parent_id:root,depth:1,referral_ordinal:String(i)}))],
    pending:[{id:"waiting",name:"정회원 3",code:"WAIT00000003",placement_reason:"롤업 대상 상위 추천인 없음"}]}}));
  await page.goto("/organization");
  await expect(page.getByText("자동 배치 대기 (1)")).toBeVisible();
  await expect(page.getByText(/정회원 3.*롤업 대상 상위 추천인 없음/)).toBeVisible();
  for(const i of [1,2,4,5]) await expect(page.getByRole("button",{name:`정회원 ${i} 하위 조직 보기`})).toBeVisible();
  await expect(page.getByText("좌측 빈 자리")).toHaveCount(0);
  await expect(page.getByText("배치 확정")).toHaveCount(0);
  await page.getByRole("button",{name:"추천 조직도",exact:true}).click();
  await expect(page.getByRole("button",{name:"추천 조직도",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("status").filter({hasText:"조직도를 불러오는 중"})).toHaveCount(0);
  await expect.poll(async()=>{
    const rootBox=await page.locator(".org-root").boundingBox(),board=await page.locator(".org-viewport").boundingBox();
    return rootBox && board ? Math.abs(rootBox.x+rootBox.width/2-board.x-board.width/2) : 999;
  }).toBeLessThan(3);
  await page.screenshot({path:"artifacts/organization-automatic-desktop.png",fullPage:true});
});
