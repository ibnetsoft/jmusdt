import { z } from "zod";
import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { database, transaction } from "@/lib/db";

const title = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(10000);
const announcement = z.object({title_ko:title,body_ko:body,title_en:title,body_en:body,title_ja:title,body_ja:body}).strict();
export async function GET() {
  return api(async () => {
    await identity(true);
    const result = await database().query("SELECT id,title_ko,body_ko,title_en,body_en,title_ja,body_ja,created_at FROM announcements ORDER BY created_at DESC,id DESC LIMIT 200");
    return { announcements: result.rows };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const {user} = await identity(true);
    const parsed = announcement.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400,"각 언어의 공지 제목과 내용을 확인하세요.");
    const d=parsed.data;
    return transaction(async client => {
      const result=await client.query("INSERT INTO announcements(title_ko,body_ko,title_en,body_en,title_ja,body_ja,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at",[d.title_ko,d.body_ko,d.title_en,d.body_en,d.title_ja,d.body_ja,user.id]);
      await client.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'announcement.created',$2::jsonb)",[user.id,JSON.stringify({id:result.rows[0].id})]);
      return {ok:true,announcement:result.rows[0]};
    });
  });
}
