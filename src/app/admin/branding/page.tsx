import { serverI18n } from "@/lib/i18n-server";
import { identity,HttpError } from "@/lib/http";
import { redirect } from "next/navigation";
import { BrandingAdmin } from "@/components/branding-admin";
export const dynamic="force-dynamic";
export default async function Page(){
  const { tr } = await serverI18n();try{await identity(true);}catch(e){if(e instanceof HttpError && e.status===401)redirect("/login");return <main>{tr("관리자 권한이 필요합니다.")}</main>;}return <BrandingAdmin/>;}
