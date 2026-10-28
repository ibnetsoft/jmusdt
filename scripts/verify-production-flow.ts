import "./load-env";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {chromium,expect,type Browser} from "@playwright/test";
import {database,transaction} from "../src/lib/db";

// Explicit release QA only. No chain deposit or withdrawal is fabricated.
assert.ok(process.argv.includes("--execute-qa"),"Explicit --execute-qa is required");
const origin=new URL(process.argv[process.argv.indexOf("--origin")+1] || "https://jmusdt.com").origin;
assert.equal(origin,"https://jmusdt.com");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,"thxpejttykcdgvjjgwxv.supabase.co");
assert.ok(process.env.CRON_SECRET,"CRON_SECRET is required");
const run="release-"+randomBytes(6).toString("hex"),pool=database();
const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
type User={id:string;role:string;cookie:string;seed:bigint};
const users:User[]=[],products:string[]=[],orders:string[]=[],checks:string[]=[];
const evidence:Record<string,unknown>={};
let browser:Browser|undefined,guard=false,success=false;
const output=`artifacts/release/${run}.json`;
async function save() {
  await mkdir("artifacts/release",{recursive:true});
  await writeFile(output,JSON.stringify({run,origin,success,users:users.map(u=>({id:u.id,role:u.role,seed:u.seed.toString()})),products,orders,checks,evidence},null,2));
}
function pass(message:string) {checks.push(message);console.log("PASS "+message);}
async function call(path:string,user?:User,body?:unknown,method?:string) {
  const response=await fetch(origin+path,{method:method || (body?"POST":"GET"),headers:{Origin:origin,...(user?{Cookie:user.cookie}:{}),...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  assert.equal(response.status,200,`${path}: HTTP ${response.status}: ${data.error || "unexpected response"}`);
  return data;
}
async function member(role:string,parent?:User,admin=false) {
  const password=randomBytes(30).toString("base64url"),email=`${run}-${role}@example.com`;
  const code=parent?(await pool.query("SELECT referral_code FROM member_network WHERE user_id=$1",[parent.id])).rows[0].referral_code:undefined;
  const {data,error}=await auth.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name:`QA ${run} ${role}`,referral_code:code},app_metadata:admin?{adminConsole:true}:{}});
  if(error) throw new Error("QA user creation failed: "+error.code);
  const user:User={id:data.user.id,role,cookie:"",seed:0n};users.push(user);await save();
  const response=await fetch(origin+"/api/auth",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({action:"login",email,password})});
  assert.equal(response.status,200,"QA login failed");
  user.cookie=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
  assert.ok(user.cookie);
  return user;
}
async function regular(user:User,admin:User) {
  await call("/api/admin/grades",admin,{action:"assign",userId:user.id,gradeCode:"vip",reason:`QA ${run}: manual regular membership verification`});
}
async function seed(user:User,points:bigint) {
  const units=points*1000000n;
  await transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(9692027)");
    const prior=(await db.query("SELECT coalesce((SELECT available FROM point_balances WHERE user_id=$1),0)::text AS units",[user.id])).rows[0].units;
    assert.equal(prior,"0");
    const tx=(await db.query("INSERT INTO transactions(user_id,kind,amount,status,asset,note) VALUES($1,'reward',$2,'completed','POINT',$3) RETURNING id",[user.id,units.toString(),`QA ${run}: temporary POINT test funding, no on-chain deposit`])).rows[0].id;
    await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET available=point_balances.available+EXCLUDED.available",[user.id,units.toString()]);
    const batch=randomUUID();
    await db.query("INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES($1,$2,$3,$4,'POINT'),($1,$2,$5,$6,'POINT')",[tx,batch,`qa:${run}:funding`,(-units).toString(),user.id+":available",units.toString()]);
    await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'qa.release_seed',$2)",[user.id,JSON.stringify({run,units:units.toString()})]);
  });
  user.seed=units;await save();
}
const zero={referral:"0",sponsor:"0",mom:"0",daily:"0",days:0,lucky:0,treasure:0};
async function product(admin:User,kind:"none"|"lucky"|"treasure",price:string,rewardPlan=zero) {
  const p=(await call("/api/admin/products",admin,{name:`[운영검증 전용] ${run} ${kind}`,description:"자동 통합검증 상품. 테스트 회원 외 구매 불가. 검증 후 판매 중지.",imageUrl:"",price,stock:20,active:false,shippingType:"none",packageType:kind,rewardPlan})).product;
  products.push(p.id);await save();return p.id as string;
}
async function installGuard() {
  // The guard is temporary, only matches this run's product UUIDs, and leaves normal products untouched.
  const ids=(list:string[])=>list.map(id=>{assert.match(id,/^[0-9a-f-]{36}$/);return `'${id}'::uuid`;}).join(",");
  await transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(9692027)");
    await db.query(`CREATE FUNCTION qa_release_product_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF NEW.product_id=ANY(ARRAY[${ids(products)}]) AND NOT NEW.user_id=ANY(ARRAY[${ids(users.map(u=>u.id))}]) THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE'; END IF; RETURN NEW; END $$; REVOKE ALL ON FUNCTION qa_release_product_guard() FROM PUBLIC,anon,authenticated; CREATE TRIGGER order_01_qa_release_guard BEFORE INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION qa_release_product_guard();`);
  });guard=true;
}
async function buy(user:User,productId:string,qty:number) {
  const version=(await pool.query("UPDATE shop_products SET active=true WHERE id=$1 RETURNING version",[productId])).rows[0].version;
  try {
    const marketingVersion=(await pool.query("SELECT version FROM marketing_settings WHERE id=true")).rows[0].version;
    const body={productId,quantity:qty,version,requestKey:randomUUID(),marketingVersion};
    const order=await call("/api/shop",user,body);orders.push(order.id);await save();
    assert.equal((await call("/api/shop",user,body)).id,order.id);
    return order.id as string;
  } finally {await pool.query("UPDATE shop_products SET active=false WHERE id=$1",[productId]);}
}
async function cleanup() {
  // Retain append-only financial history. All test orders are refunded, funding is reversed,
  // and the QA accounts are blocked rather than deleting referenced transactions.
  await transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(9692027)");
    await db.query("UPDATE shop_products SET active=false WHERE id=ANY($1::uuid[])",[products]);
    const actor=users[0]?.id;
    if(actor) {
      const remaining=await db.query("SELECT id FROM shop_orders WHERE user_id=ANY($1::uuid[]) AND status<>'cancelled' ORDER BY created_at DESC",[users.map(u=>u.id)]);
      for(const o of remaining.rows) await db.query("SELECT shop_refund($1,$2,$3)",[o.id,actor,`QA ${run} cleanup`]);
    }
    for(const user of users) {
      const value=BigInt((await db.query("SELECT coalesce((SELECT available FROM point_balances WHERE user_id=$1),0)::text AS units",[user.id])).rows[0].units);
      if(value>0n) {
        assert.ok(value>=user.seed,"Unexpected QA debt or funding mismatch; manual audit required");
        const excess=value-user.seed,tx=(await db.query("INSERT INTO transactions(user_id,kind,amount,status,asset,note) VALUES($1,'reward_reversal',$2,'completed','POINT',$3) RETURNING id",[user.id,value.toString(),`QA ${run}: reverse test funding and simulated pool dividends`])).rows[0].id,batch=randomUUID();
        await db.query("UPDATE point_balances SET available=0 WHERE user_id=$1",[user.id]);
        await db.query("INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES($1,$2,$3,$4,'POINT')",[tx,batch,user.id+":available",(-value).toString()]);
        if(user.seed>0n) await db.query("INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES($1,$2,$3,$4,'POINT')",[tx,batch,`qa:${run}:funding`,user.seed.toString()]);
        if(excess>0n) await db.query("INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES($1,$2,'shop:revenue',$3,'POINT')",[tx,batch,excess.toString()]);
      } else assert.equal(user.seed,0n,"Seeded balance unexpectedly missing");
      await db.query("UPDATE profiles SET status='blocked' WHERE id=$1",[user.id]);
    }
    if(guard) await db.query("DROP TRIGGER order_01_qa_release_guard ON shop_orders; DROP FUNCTION qa_release_product_guard()");
    await db.query("INSERT INTO audit_logs(action,details) VALUES('qa.release_cleanup',$1)",[JSON.stringify({run,users:users.map(u=>u.id),products,orders})]);
  });
  for(const user of users) {
    if(user.cookie) await call("/api/auth",user,undefined,"DELETE");
    const {error}=await auth.auth.admin.updateUserById(user.id,{ban_duration:"876000h",app_metadata:{adminConsole:false}});
    if(error) throw new Error("Failed to disable QA auth account: "+error.code);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) q")).rows[0].n,0);
  assert.equal((await pool.query("SELECT coalesce(sum(available),0)::text AS units FROM point_balances WHERE user_id=ANY($1::uuid[])",[users.map(u=>u.id)])).rows[0].units,"0");
  assert.equal((await pool.query("SELECT coalesce(sum(units),0)::text AS units FROM journal WHERE account=$1",[`qa:${run}:funding`])).rows[0].units,"0");
  const baseline=JSON.parse(await readFile("artifacts/release/baseline.json","utf8"));
  const after=(await pool.query("SELECT p.id,p.status,b.available::text,b.reserved::text,coalesce(pb.available,0)::text AS points FROM profiles p LEFT JOIN balances b ON b.user_id=p.id LEFT JOIN point_balances pb ON pb.user_id=p.id WHERE p.id=ANY($1::uuid[]) ORDER BY p.id",[baseline.balances.map((r:{id:string})=>r.id)])).rows;
  assert.deepEqual(after,baseline.balances,"Existing member balances or account status changed");
  const nonzero=(await pool.query("SELECT account,asset,sum(units)::text AS units FROM journal GROUP BY account,asset HAVING sum(units)<>0 ORDER BY account,asset")).rows;
  assert.deepEqual(nonzero,baseline.ledger.filter((r:{units:string})=>r.units!=="0"),"Company accounting did not return to its baseline");
  pass("QA orders refunded, test balances zero, company accounts restored, existing members unchanged, QA sessions revoked and accounts blocked");
}

try {
  assert.equal((await pool.query("SELECT to_regprocedure('qa_release_product_guard()') AS function")).rows[0].function,null,"An earlier QA guard requires cleanup before another run");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM daily_pool_entries WHERE settled_at IS NULL AND cancelled_at IS NULL AND cutoff<=now()")).rows[0].n,0,"Existing due pools: use an isolated test environment instead");
  const admin=await member("admin",undefined,true);await regular(admin,admin);
  const grand=await member("grand",admin);await regular(grand,admin);
  const ref=await member("ref",grand);await regular(ref,admin);
  const one=await member("one",ref),two=await member("two",ref),buyer=await member("buyer",ref);
  assert.equal((await call("/api/organization",buyer)).eligible,false);
  const wallet=await call("/api/wallet",buyer);assert.match(wallet.referralCode,/^[A-F0-9]{12}$/);
  pass("Production auth, automatic referral code, general membership restriction and manual regular assignment");
  const lucky=await product(admin,"lucky","350000"),treasure=await product(admin,"treasure","3500000");
  const goods=await product(admin,"none","50000",{referral:"2",sponsor:"3",mom:"3",daily:"1",days:2,lucky:7,treasure:5});
  await installGuard();
  await seed(one,5000000n);await seed(two,10000000n);await seed(buyer,1000000n);
  await buy(one,lucky,1);await buy(two,lucky,2);
  await buy(one,treasure,1);await buy(two,treasure,2);
  assert.equal((await call("/api/wallet",one)).user.gradeName,"정회원");
  const cancelled=await buy(buyer,goods,1);
  await call("/api/orders/cancel",buyer,{orderId:cancelled,reason:`QA ${run} pre-close cancellation`});
  await call("/api/admin/orders",admin,{orderId:cancelled,action:"approve",reason:`QA ${run} pre-close refund`});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM daily_pool_entries WHERE order_id=$1 AND cancelled_at IS NULL",[cancelled])).rows[0].n,0);
  pass("Package quantities 1:2, purchase idempotency, automatic regular promotion and pre-close pool cancellation");

  // The final purchase is made in the deployed browser UI, using the same session as API checks.
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addCookies(buyer.cookie.split("; ").map(s=>{const i=s.indexOf("=");return {name:s.slice(0,i),value:s.slice(i+1),url:origin,secure:true,sameSite:"Lax" as const};}));
  const page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await pool.query("UPDATE shop_products SET active=true WHERE id=$1",[goods]);
  await page.goto(origin+"/shop/"+goods);
  const responsePromise=page.waitForResponse(r=>r.url()===origin+"/api/shop" && r.request().method()==="POST");
  await page.getByRole("button",{name:"50,000.000000 포인트 결제 확정",exact:true}).click();
  const purchaseResponse=await responsePromise;assert.equal(purchaseResponse.status(),200);
  const bought=await purchaseResponse.json();orders.push(bought.id);await save();
  await expect(page.getByRole("status")).toContainText("구매가 완료되었습니다");
  await pool.query("UPDATE shop_products SET active=false WHERE id=$1",[goods]);
  await page.screenshot({path:`artifacts/release/${run}-purchase.png`,fullPage:true});
  await page.goto(origin+"/mypage");
  await expect(page.getByText("회원등급: 정회원")).toBeVisible();
  await expect(page.getByLabel("추천 가입 링크")).toHaveValue(origin+"/login?ref="+wallet.referralCode);
  await page.screenshot({path:`artifacts/release/${run}-mypage.png`,fullPage:true});
  const snapshot=(await pool.query("SELECT reward_snapshot FROM shop_orders WHERE id=$1",[bought.id])).rows[0].reward_snapshot;
  assert.equal(snapshot.referral,ref.id);assert.equal(snapshot.sponsor,grand.id);assert.equal(snapshot.mom,admin.id);
  const direct=(await pool.query("SELECT r.type,r.status,r.amount::text,t.asset FROM marketing_rewards r JOIN transactions t ON t.id=r.transaction_id WHERE r.order_id=$1 ORDER BY type",[bought.id])).rows;
  assert.deepEqual(direct,[{type:"mom",status:"paid",amount:"3000000",asset:"POINT"},{type:"referral",status:"paid",amount:"2000000",asset:"POINT"},{type:"sponsor",status:"paid",amount:"3000000",asset:"POINT"}]);
  const timing=(await pool.query("SELECT bool_and(cutoff=((o.created_at AT TIME ZONE 'Asia/Seoul')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul') AS correct FROM daily_pool_entries e JOIN shop_orders o ON o.id=e.order_id WHERE o.id=$1",[bought.id])).rows[0].correct;
  assert.equal(timing,true);
  pass("Live browser purchase → API → POINT ledger → 3rd regular rollup → immediate referral/sponsor/mom payments → mypage rendering");

  const cutoff=(await pool.query("SELECT (((now() AT TIME ZONE 'Asia/Seoul')::date-1)::timestamp AT TIME ZONE 'Asia/Seoul')::text AS cutoff")).rows[0].cutoff;
  await transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(9692027)");
    await db.query("UPDATE shop_orders SET created_at=$2::timestamptz-interval '12 hours' WHERE user_id=ANY($1::uuid[])",[users.map(u=>u.id),cutoff]);
    await db.query("UPDATE member_network SET activated_at=$2::timestamptz-interval '2 days' WHERE user_id=ANY($1::uuid[]) AND activated_at IS NOT NULL",[users.map(u=>u.id),cutoff]);
    await db.query("UPDATE daily_pool_entries SET cutoff=$2 WHERE order_id=ANY($1::uuid[])",[orders,cutoff]);
    await db.query("UPDATE marketing_rewards SET due_date=($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=$1 AND type='daily' AND installment=1",[bought.id,cutoff]);
    await db.query("INSERT INTO audit_logs(action,details) VALUES('qa.midnight_simulation',$1)",[JSON.stringify({run,cutoff,orders})]);
  });
  const unauthorized=await fetch(origin+"/api/cron/marketing");assert.equal(unauthorized.status,401);
  async function cron() {
    const response=await fetch(origin+"/api/cron/marketing",{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}});
    const result=await response.json();assert.equal(response.status,200,"Authenticated production cron failed");return result;
  }
  const first=await cron();assert.equal(first.paid,1);assert.equal(first.poolRuns,2);
  const payments=(await pool.query("SELECT r.kind,p.user_id,p.quantity::text,p.amount::text FROM daily_pool_payments p JOIN daily_pool_runs r ON r.id=p.run_id WHERE r.cutoff=$1 ORDER BY r.kind,p.amount",[cutoff])).rows;
  assert.deepEqual(payments,[{kind:"lucky",user_id:one.id,quantity:"1",amount:"2333333"},{kind:"lucky",user_id:two.id,quantity:"2",amount:"4666666"},{kind:"treasure",user_id:one.id,quantity:"1",amount:"1666666"},{kind:"treasure",user_id:two.id,quantity:"2",amount:"3333333"}]);
  const runs=(await pool.query("SELECT kind,total::text,distributed::text,retained::text,package_count::text FROM daily_pool_runs WHERE cutoff=$1 ORDER BY kind",[cutoff])).rows;
  assert.deepEqual(runs,[{kind:"lucky",total:"7000000",distributed:"6999999",retained:"1",package_count:"3"},{kind:"treasure",total:"5000000",distributed:"4999999",retained:"1",package_count:"3"}]);
  const replay=await cron();assert.equal(replay.paid,0);assert.equal(replay.poolRuns,0);
  const memberRewards=await call("/api/rewards",one);assert.equal(memberRewards.pools.length,2);
  await page.goto(origin+"/rewards");await expect(page.getByRole("heading",{name:"나의 리워드",exact:true})).toBeVisible();
  await page.screenshot({path:`artifacts/release/${run}-rewards.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  evidence.cutoffSimulation={cutoff,first,replay,runs,payments,actualWallClockMidnightObserved:false};
  pass("Production cron authentication, simulated KST midnight daily + 1:2 package dividends, exact rounding/company retention, reward API/UI and replay protection");
  for(const orderId of [...orders].reverse()) {
    const order=(await pool.query("SELECT user_id,status FROM shop_orders WHERE id=$1",[orderId])).rows[0];
    if(order.status==="cancelled") continue;
    const owner=users.find(u=>u.id===order.user_id)!;
    await call("/api/orders/cancel",owner,{orderId,reason:`QA ${run} refund after distribution`});
    await call("/api/admin/orders",admin,{orderId,action:"approve",reason:`QA ${run} refund after distribution`});
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM shop_orders WHERE id=ANY($1::uuid[]) AND status<>'cancelled'",[orders])).rows[0].n,0);
  assert.equal((await pool.query("SELECT coalesce(sum(outstanding),0)::text AS units FROM marketing_debts WHERE user_id=ANY($1::uuid[])",[users.map(u=>u.id)])).rows[0].units,"0");
  assert.equal((await pool.query("SELECT sum(p.amount)::text AS units FROM daily_pool_payments p JOIN daily_pool_runs r ON r.id=p.run_id WHERE r.cutoff=$1",[cutoff])).rows[0].units,"11999998");
  pass("Production cancellation/refund APIs revoke future rights and packages; already closed pool payments are preserved");
  success=true;
} finally {
  await browser?.close();
  try {await cleanup();evidence.cleanup="PASS";}
  catch(error) {success=false;evidence.cleanup="FAILED";throw error;}
  finally {await save();await pool.end();console.log("Evidence: "+output);}
}
