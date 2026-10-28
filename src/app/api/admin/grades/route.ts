import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api, checkOrigin, HttpError, identity } from "@/lib/http";
import { database, transaction } from "@/lib/db";

export async function GET(request: Request) {
  return api(async () => {
    await identity(true);
    const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 150);
    const [grades, members] = await Promise.all([
      database().query("SELECT code,name,reward_eligible FROM member_grades ORDER BY CASE code WHEN 'general' THEN 0 WHEN 'vip' THEN 1 ELSE 2 END,name"),
      database().query("SELECT p.id,p.name,p.email,p.grade_code,g.name AS grade_name,coalesce((SELECT sum(o.total) FROM shop_orders o WHERE o.user_id=p.id AND o.currency='POINT' AND o.status IN ('paid','cancellation_requested')),0)::text AS total_points FROM profiles p JOIN member_grades g ON g.code=p.grade_code WHERE ($1='' OR p.email ILIKE '%'||$1||'%' OR p.name ILIKE '%'||$1||'%') ORDER BY p.created_at DESC LIMIT 100", [q]),
    ]);
    return {grades:grades.rows,members:members.rows};
  });
}
const input = z.discriminatedUnion("action", [
  z.object({action:z.literal("create"),name:z.string().trim().min(1).max(60),rewardEligible:z.boolean().default(false)}),
  z.object({action:z.literal("assign"),userId:z.string().uuid(),gradeCode:z.string().min(1).max(80),reason:z.string().trim().min(1).max(500)}),
]);
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const {user} = await identity(true);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400,"등급과 처리 내용을 확인해 주세요.");
    const p=parsed.data;
    return transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(9692027)");
      if (p.action === "create") {
        const result=await db.query("INSERT INTO member_grades(code,name,reward_eligible) VALUES($1,$2,$3) ON CONFLICT(name) DO NOTHING RETURNING code,name,reward_eligible",[randomUUID(),p.name,p.rewardEligible]);
        if (!result.rows.length) throw new HttpError(409,"같은 이름의 등급이 이미 있습니다.");
        await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'member.grade_created',$2)",[user.id,JSON.stringify({code:result.rows[0].code,name:p.name,rewardEligible:p.rewardEligible})]);
        return {grade:result.rows[0]};
      }
      const old=(await db.query("SELECT grade_code FROM profiles WHERE id=$1 FOR UPDATE",[p.userId])).rows[0];
      if (!old) throw new HttpError(404,"회원을 찾을 수 없습니다.");
      const grade=(await db.query("SELECT code FROM member_grades WHERE code=$1",[p.gradeCode])).rows[0];
      if (!grade) throw new HttpError(400,"존재하지 않는 등급입니다.");
      if (old.grade_code !== p.gradeCode) {
        await db.query("UPDATE profiles SET grade_code=$2 WHERE id=$1",[p.userId,p.gradeCode]);
        await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'member.grade_assigned',$2)",[user.id,JSON.stringify({userId:p.userId,from:old.grade_code,to:p.gradeCode,reason:p.reason})]);
      }
      return {ok:true};
    });
  });
}
