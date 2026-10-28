import "./load-env";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {chromium,expect,type Browser} from "@playwright/test";
import {database,transaction} from "../src/lib/db";

assert.ok(process.argv.includes("--publish"),"Explicit --publish is required");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,"thxpejttykcdgvjjgwxv.supabase.co");
const origin="https://jmusdt.com",pool=database();
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const manifest=JSON.parse(await readFile("artifacts/package-catalog/products.json","utf8"));
const email=`catalog-qa-${randomBytes(8).toString("hex")}@example.com`,password=randomBytes(30).toString("base64url");
let userId:string|undefined,cookie="",browser:Browser|undefined;
const published:Record<string,unknown>[]=[];
try {
  const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name:"QA package catalog verification"},app_metadata:{adminConsole:true}});
  if(error) throw new Error("Catalog QA account creation failed: "+error.code);
  userId=data.user.id;
  const login=await fetch(origin+"/api/auth",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({action:"login",email,password})});
  assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
  async function post(body:unknown,expected=200) {
    const response=await fetch(origin+"/api/admin/products",{method:"POST",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,expected,result.error || "Unexpected catalog response");return result;
  }
  for(const item of manifest) {
    const p=(await pool.query("SELECT * FROM shop_products WHERE package_type=$1 AND name=$2 ORDER BY created_at LIMIT 1",[item.kind,item.input.name])).rows[0];
    assert.ok(p,"Prepared catalog product is missing");
    // Invalid extra rewards must be rejected without editing the real product.
    await post({...item.input,id:p.id,version:p.version,rewardPlan:{...item.input.rewardPlan,referral:"1"}},400);
    const result=await post({...item.input,id:p.id,version:p.version,active:true});
    assert.equal(result.product.reward_plan.days,369);
    assert.deepEqual(result.product.reward_plan,item.rewardPlanUnits);
    assert.equal(result.product.shipping_type,"none");
    published.push({id:p.id,name:p.name,url:origin+"/shop/"+p.id,price:item.input.price,daily:item.input.rewardPlan.daily,days:369,image:item.input.imageUrl});
  }
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies(cookie.split("; ").map(s=>{const i=s.indexOf("=");return {name:s.slice(0,i),value:s.slice(i+1),url:origin,secure:true,sameSite:"Lax" as const};}));
  const page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+"/shop");
  for(const item of published) {
    await expect(page.getByRole("heading",{name:String(item.name),exact:true})).toBeVisible();
    const img=page.getByRole("img",{name:String(item.name),exact:true});
    await expect.poll(()=>img.evaluate((element:HTMLImageElement)=>element.naturalWidth)).toBeGreaterThan(0);
  }
  await page.screenshot({path:"artifacts/package-catalog/shop-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for(const item of published) {
    await page.goto(String(item.url));
    await expect(page.getByRole("heading",{name:String(item.name),exact:true})).toBeVisible();
    const daily=item.name==="복주머니 패키지"?"1,000.000000 P × 369일":"10,000.000000 P × 369일";
    await expect(page.getByText(/상품 1개당 데일리/)).toContainText(daily);
    await expect(page.getByText(/1\/N 배당 참여 자격은 유지/)).toBeVisible();
    await expect(page.getByRole("button",{name:"포인트 잔액 부족",exact:true})).toBeDisabled();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const kind=item.name==="복주머니 패키지"?"lucky":"treasure";
    await page.screenshot({path:`artifacts/package-catalog/${kind}-mobile.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  await writeFile("artifacts/package-catalog/published.json",JSON.stringify({origin,published,checks:["Production administrator API accepted exact 369-day package plans","Extra referral rewards were rejected","Generated images loaded in the live storefront","Both mobile details showed the package conditions without horizontal overflow"],financialTransactionsCreated:0},null,2));
  console.log(JSON.stringify({published,verification:"PASS",financialTransactionsCreated:0},null,2));
} finally {
  await browser?.close();
  if(userId) {
    if(cookie) await fetch(origin+"/api/auth",{method:"DELETE",headers:{Origin:origin,Cookie:cookie}});
    const {error}=await client.auth.admin.updateUserById(userId,{ban_duration:"876000h",app_metadata:{adminConsole:false}});
    if(error) throw new Error("Failed to disable catalog QA account: "+error.code);
    await transaction(async db=>{await db.query("SELECT pg_advisory_xact_lock(9692027)");await db.query("UPDATE profiles SET status='blocked' WHERE id=$1",[userId]);await db.query("INSERT INTO audit_logs(action,details) VALUES('catalog.verification_completed',$1)",[JSON.stringify({userId,published:published.map(p=>p.id)})]);});
  }
  await pool.end();
}
