import "./load-env";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {normalizeProductImage} from "../src/lib/product-image";
import {productInput,productPrice} from "../src/lib/commerce";
import {planUnits,validRewardBudget,zeroPlan} from "../src/lib/marketing-plan";

assert.ok(process.argv.includes("--upload"),"Explicit --upload is required");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,"thxpejttykcdgvjjgwxv.supabase.co");
const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const products=[];
for(const kind of ["lucky","treasure"] as const) {
  const name=kind==="lucky"?"복주머니 패키지":"보물상자 패키지",price=kind==="lucky"?"350000":"3500000",daily=kind==="lucky"?"1000":"10000";
  const label=kind==="lucky"?"복주머니":"보물상자",dailyLabel=kind==="lucky"?"1,000":"10,000",total=kind==="lucky"?"369,000":"3,690,000";
  const image=await normalizeProductImage(await readFile(`assets/products/${kind}-package.png`),"image/png");
  const hash=createHash("sha256").update(image).digest("hex"),path=`catalog/${kind}-package-${hash.slice(0,16)}.webp`;
  const imageUrl=auth.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  const existing=await fetch(imageUrl);
  if(existing.ok) assert.equal(createHash("sha256").update(Buffer.from(await existing.arrayBuffer())).digest("hex"),hash);
  else {
    const missing=await existing.json().catch(()=>({}));
    assert.ok(existing.status===404 || (existing.status===400 && String(missing.statusCode)==="404"),"Unexpected storage lookup response");
    const {error}=await auth.storage.from("product-images").upload(path,image,{contentType:"image/webp",cacheControl:"31536000",upsert:false});
    if(error) throw new Error("Package image upload failed: "+error.message);
  }
  const check=await fetch(imageUrl);assert.equal(check.status,200);assert.match(check.headers.get("content-type") || "",/^image\/webp/);
  await writeFile(`assets/products/${kind}-package.webp`,image);
  const input=productInput.parse({name,price,imageUrl,stock:1000000,active:true,shippingType:"none",packageType:kind,
    description:`${name} 1개당 구매 다음 날부터 매일 한국시간 자정에 ${dailyLabel} P씩 369일간 지급됩니다. 총 데일리 지급액은 ${total} P입니다. 배송이 필요 없는 디지털 패키지입니다.`,
    detailBlocks:[
      {type:"heading",text:`매일 ${dailyLabel} P × 369일`},
      {type:"text",text:`패키지 1개당 데일리 지급 조건입니다. 여러 개를 구매하면 구매 수량에 비례해 지급됩니다. 구매 다음 날부터 한국시간 자정 일배당으로 시작합니다. 총 ${total} P가 일반 포인트 잔액에 지급됩니다.`},
      {type:"heading",text:"패키지 보유 혜택과 보상 안내"},
      {type:"text",text:`보유한 ${label} 패키지 수량에 비례한 회사 ${label}P 적립금의 1/N 배당 참여 자격은 유지됩니다. 이 상품을 구매하는 거래 자체에서는 추천·후원·맘 리워드와 회사 복주머니P·보물상자P 적립이 발생하지 않습니다.`},
      {type:"text",text:"데일리와 회사 적립금 배당은 정회원·이메일 인증·정상 계정 조건을 충족한 회원에게 지급됩니다. 취소 확정 시 남은 데일리 지급 권리와 해당 패키지 보유 자격은 취소되며, 환불·회수는 서비스의 주문 취소 정책을 따릅니다. 지급 지연이나 누락은 이후 정산에서 재처리합니다."}
    ],rewardPlan:{...zeroPlan,daily,days:369}});
  const units=planUnits(input.rewardPlan!);assert.equal(validRewardBudget(units,BigInt(productPrice(price)),kind),true);
  products.push({kind,input,priceUnits:productPrice(price),rewardPlanUnits:units,image:{path,url:imageUrl,sha256:hash,bytes:image.length}});
}
await mkdir("artifacts/package-catalog",{recursive:true});
await writeFile("artifacts/package-catalog/products.json",JSON.stringify(products,null,2));
console.log(JSON.stringify({prepared:products.map(p=>({name:p.input.name,price:p.input.price,daily:p.input.rewardPlan?.daily,days:369,image:p.image.url})),manifest:"artifacts/package-catalog/products.json"},null,2));
