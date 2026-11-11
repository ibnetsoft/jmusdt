import { api, checkOrigin, HttpError, identity } from "@/lib/http";
import { database } from "@/lib/db";
import { MAX_AVATAR_INPUT, normalizeAvatar } from "@/lib/profile-avatar";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { user } = await identity();
    const result = await database().query("SELECT image FROM profile_avatars WHERE user_id=$1", [user.id]);
    if (!result.rows.length) return new Response(null, {status:404,headers:{"Cache-Control":"private, no-store"}});
    return new Response(new Uint8Array(result.rows[0].image), {headers:{"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch (error) {
    if (error instanceof HttpError) return new Response(null, {status:error.status,headers:{"Cache-Control":"private, no-store"}});
    return new Response(null, {status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}

export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const {user} = await identity();
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data") || !request.body) throw new HttpError(400,"이미지 파일을 선택해 주세요.");
    const reader=request.body.getReader(), chunks:Uint8Array[]=[];
    let size=0;
    try {
      while (true) {
        const {done,value}=await reader.read(); if (done) break;
        size+=value.length;
        if (size>MAX_AVATAR_INPUT+65536) { await reader.cancel(); throw new HttpError(413,"이미지는 3MB 이하로 선택해 주세요."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let form:FormData;
    try { form=await new Response(Buffer.concat(chunks),{headers:{"Content-Type":contentType}}).formData(); }
    catch { throw new HttpError(400,"이미지 파일을 선택해 주세요."); }
    if (form.get("accountId") !== user.id) throw new HttpError(409,"계정이 변경되었습니다. 다시 시도해 주세요.");
    const file=form.get("file");
    if (!(file instanceof File)) throw new HttpError(400,"이미지 파일을 선택해 주세요.");
    if (file.size>MAX_AVATAR_INPUT) throw new HttpError(413,"이미지는 3MB 이하로 선택해 주세요.");
    let image:Buffer;
    try { image=await normalizeAvatar(Buffer.from(await file.arrayBuffer())); }
    catch (error) { throw new HttpError(400,error instanceof Error ? error.message : "이미지를 읽을 수 없습니다."); }
    const result=await database().query(`INSERT INTO profile_avatars(user_id,image) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET image=EXCLUDED.image,version=gen_random_uuid(),updated_at=now() RETURNING version::text`,[user.id,image]);
    return {version:result.rows[0].version};
  });
}
