import { z } from "zod";
import { api, checkOrigin, identity, HttpError } from "@/lib/http";
import { SweepError } from "@/lib/sweep-chain";
import { companyWalletDashboard, createCompanyWallet, previewCompanyTransfer, approveCompanyTransfer } from "@/lib/company-transfers";
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create_wallet")}),
  z.object({action:z.literal("preview"),destination:z.string().min(1).max(64),amount:z.string().max(32)}),
  z.object({action:z.literal("approve"),id:z.string().uuid(),reason:z.string().trim().min(3).max(500),confirmation:z.literal("USDT 송금")}),
]);
export async function GET(){return api(async()=>{await identity(true);return companyWalletDashboard();});}
export async function POST(request:Request){return api(async()=>{
  checkOrigin(request);const input=schema.safeParse(await request.json());
  if(!input.success)throw new HttpError(400,"입력 내용을 확인하세요.");
  const {user}=await identity(true,true);
  try{
    if(input.data.action==='create_wallet')return createCompanyWallet(user.id);
    if(input.data.action==='preview')return previewCompanyTransfer(user.id,input.data.destination,input.data.amount);
    return approveCompanyTransfer(user.id,input.data.id,input.data.reason);
  }catch(e){if(e instanceof SweepError)throw new HttpError(409,e.message);throw e;}
});}
