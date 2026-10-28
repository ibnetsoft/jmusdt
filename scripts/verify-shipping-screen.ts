import "./load-env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { database } from "../src/lib/db";

// Browser interactions use simulated order API responses; no synthetic ledger is persisted.
if (!process.argv.includes("--test-account")) throw new Error("Explicit --test-account required");
const origin = process.env.APP_ORIGIN!;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!, {auth:{persistSession:false,autoRefreshToken:false}});
const db = database();
const email = `shipping-qa-${randomBytes(8).toString("hex")}@example.com`;
const password = randomBytes(24).toString("base64url");
let id = "";
const browser = await chromium.launch({headless:true});
try {
  const created = await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{adminConsole:true}});
  if (created.error) throw created.error;
  id = created.data.user.id;
  const context = await browser.newContext({baseURL:origin,viewport:{width:390,height:844}});
  const login = await context.request.post("/api/auth", {headers:{Origin:origin},data:{action:"login",email,password}});
  assert.equal(login.status(),200);
  const page = await context.newPage();
  const productId = randomUUID();
  const product = {id:productId,name:"배송 검증 상품",description:"테스트",detail_blocks:[],image_url:"",price:"1000000",stock:2,active:true,version:1,shipping_type:"physical",reward_plan:{referral:"0",sponsor:"0",mom:"0",daily:"0",days:0,lucky:0,treasure:0}};
  const orderId = randomUUID();
  let shippingStatus = "preparing";
  let purchased = false;
  let cancelled = false;
  const shipping = () => ({recipient:"테스트",phone:"01012345678",address:"서울 테스트 주소",note:"문 앞",status:shippingStatus,carrier:shippingStatus === "preparing" ? "" : "테스트택배",tracking_number:shippingStatus === "preparing" ? "" : "123456"});
  const order = () => ({id:orderId,user_id:id,email,member_name:"QA",product_name:product.name,product_description:"테스트",product_detail_blocks:[],quantity:1,unit_price:"1000000",total:"1000000",currency:"POINT",status:cancelled?"cancelled":"paid",created_at:new Date().toISOString(),cancellation_reason:"",refund_reason:cancelled?"테스트":"",refund_transaction_id:null,shipping:shipping()});
  await page.route("**/api/shop", async route => {
    if (route.request().method()==="POST") {
      const data=route.request().postDataJSON();
      assert.equal(data.shipping.address,"서울 테스트 주소"); purchased=true;
      await route.fulfill({json:{id:orderId}});
    } else await route.fulfill({json:{products:[product],orders:purchased?[order()]:[],available:"10000000",marketing:{enabled:false,daily_paused:false,version:1}}});
  });
  await page.route("**/api/admin/orders?**", route=>route.fulfill({json:{orders:[order()]}}));
  await page.route("**/api/admin/orders/shipping", async route=>{
    const data=route.request().postDataJSON();
    assert.equal(data.expectedStatus,shippingStatus); assert.equal(data.trackingNumber,"123456");
    shippingStatus=data.status; await route.fulfill({json:{ok:true}});
  });
  await page.route("**/api/admin/orders", async route=>{
    assert.equal(route.request().postDataJSON().action,"approve"); cancelled=true;
    await route.fulfill({json:{transactionId:randomUUID()}});
  });
  await page.goto(`/shop/${productId}`);
  await page.getByLabel("받는 분",{exact:true}).fill("테스트");
  await page.getByLabel("연락처",{exact:true}).fill("01012345678");
  await page.getByLabel("배송 주소",{exact:true}).fill("서울 테스트 주소");
  await page.getByLabel("배송 요청사항 (선택)").fill("문 앞");
  await page.getByRole("button",{name:/포인트 결제 확정/}).click();
  await page.getByText("구매가 완료되었습니다.",{exact:false}).waitFor();
  await page.goto("/admin/orders");
  await page.getByRole("button",{name:"주문 상세"}).click();
  await page.getByLabel("택배사").fill("테스트택배");
  await page.getByLabel("송장번호").fill("123456");
  await page.getByLabel("배송 상태").selectOption("shipped");
  await page.getByRole("button",{name:"배송 정보 저장"}).click();
  await page.getByText("배송 정보를 저장했습니다.").waitFor();
  await page.goto("/shop");
  await page.getByText("테스트택배 · 123456").waitFor();
  await page.goto("/admin/orders");
  await page.getByRole("button",{name:"주문 상세"}).click();
  await page.getByLabel("처리 사유").fill("테스트");
  await page.getByRole("button",{name:"취소 승인·환불 검토"}).click();
  await page.getByRole("button",{name:"취소 승인 및 전액 환불 확정"}).click();
  await page.getByText("취소 승인·전액 환불·재고 복구가 완료되었습니다.").waitFor();
  await page.goto("/shop");
  await page.getByText("취소·환불 완료").waitFor();
  console.log("Mobile browser: shipping entry, purchase display, admin shipment, tracking display and refund display PASS (simulated order API)");
  await context.close();
} finally {
  await browser.close();
  if (id) {
    await db.query("DELETE FROM point_balances WHERE user_id=$1 AND available=0",[id]);
    await db.query("DELETE FROM balances WHERE user_id=$1 AND available=0 AND reserved=0",[id]);
    await db.query("DELETE FROM profiles WHERE id=$1",[id]);
    const deleted=await admin.auth.admin.deleteUser(id); if (deleted.error) throw deleted.error;
  }
  await db.end();
}
