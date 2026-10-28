import { normalizeBrandImage } from "@/lib/brand-image";
import { api,checkOrigin,HttpError,identity } from "@/lib/http";
import { transaction } from "@/lib/db";
export const runtime="nodejs";
export async function POST(request:Request) {
  return api(async()=>{
    checkOrigin(request);
    const {user}=await identity(true);
    if(!request.headers.get("content-type")?.startsWith("multipart/form-data") || !request.body) throw new HttpError(400,"PNG 파일을 선택해 주세요.");
    const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
    try { for(;;) {const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>1200000){await reader.cancel();throw new HttpError(413,"PNG 파일은 1MB 이하여야 합니다.");} chunks.push(value);} } finally {reader.releaseLock();}
    let file:FormDataEntryValue|null;
    try {file=(await new Response(Buffer.concat(chunks),{headers:{"Content-Type":request.headers.get("content-type")!}}).formData()).get("file");} catch {throw new HttpError(400,"업로드 내용을 확인해 주세요.");}
    if(!(file instanceof File)||file.type!=="image/png"||file.size>1048576)throw new HttpError(400,"1MB 이하 PNG 파일을 선택해 주세요.");
    let image:Buffer;
    try {image=await normalizeBrandImage(Buffer.from(await file.arrayBuffer()));} catch {throw new HttpError(400,"PNG 이미지가 올바르지 않거나 크기가 너무 큽니다.");}
    await transaction(async db=>{await db.query("INSERT INTO app_branding(id,logo_png,updated_at) VALUES(true,$1,now()) ON CONFLICT(id) DO UPDATE SET logo_png=excluded.logo_png,updated_at=now()",[image]); await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'branding.logo_updated',$2)",[user.id,JSON.stringify({bytes:image.length})]);});
    return {ok:true};
  });
}
