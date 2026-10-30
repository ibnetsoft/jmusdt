import { timingSafeEqual } from "node:crypto";
import { api, HttpError } from "@/lib/http";
import { advanceCompanyTransfer, verifyCompanyWalletBackup } from "@/lib/company-transfers";
export const maxDuration=60;
export async function GET(request:Request){return api(async()=>{
  const secret=process.env.COMPANY_TRANSFER_CRON_SECRET || "";
  const given=Buffer.from(request.headers.get("authorization") || ""), expected=Buffer.from(`Bearer ${secret}`);
  if(secret.length<32 || given.length!==expected.length || !timingSafeEqual(given,expected))throw new HttpError(401,"인증이 필요합니다.");
  await verifyCompanyWalletBackup();
  return advanceCompanyTransfer();
});}
