"use client";
import Link from "next/link";
import { useI18n } from "./i18n";

import { useCallback, useEffect, useState } from "react";
import { formatUsdt } from "@/lib/money";
import "./shop.css";
type Grade={code:string;name:string;reward_eligible:boolean};
type Member={id:string;name:string;email:string;grade_code:string;grade_name:string;total_points:string};
export function MemberGrades() {
  const { tr } = useI18n();
  const [rewardEligible,setRewardEligible]=useState(false);
  const [grades,setGrades]=useState<Grade[]>([]),[members,setMembers]=useState<Member[]>([]),[name,setName]=useState(""),[q,setQ]=useState(""),[query,setQuery]=useState(""),[selected,setSelected]=useState<Member|null>(null),[grade,setGrade]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const load=useCallback(async()=>{const r=await fetch("/api/admin/grades?"+new URLSearchParams({q:query}),{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error);setGrades(d.grades);setMembers(d.members);},[query]);
  useEffect(()=>{void load().catch(e=>setMessage(e.message));},[load]);
  async function submit(body:unknown) {setBusy(true);setMessage("");try{const r=await fetch("/api/admin/grades",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);setName("");setSelected(null);setReason("");await load();setMessage("저장했습니다.");}catch(e){setMessage(e instanceof Error?e.message:"처리 실패");}finally{setBusy(false);}}
  return <main className="commerce"><header><Link href="/admin">{tr("← 관리자 콘솔")}</Link></header><p className="shop-kicker">ADMIN / MEMBER GRADES</p><h1>{tr("회원등급 관리")}</h1><p>{tr("일반회원은 본인 구매 누적 50,000 P 이상이면 정회원으로 자동 승급됩니다. 관리자가 구매 없이 정회원으로 지정할 수도 있습니다. 정회원과 추가 등급은 자동 승급 처리로 변경하지 않습니다.")}</p>
    {tr(message) && <p role="status">{tr(message)}</p>}
    <form className="shop-editor" onSubmit={e=>{e.preventDefault();void submit({action:"create",name,rewardEligible});}}><h2>{tr("등급 추가")}</h2><label>{tr("새 등급 이름")}<input value={name} required maxLength={60} onChange={e=>setName(e.target.value)} /></label><label><input type="checkbox" checked={rewardEligible} onChange={e=>setRewardEligible(e.target.checked)} />{tr(" 정회원과 동일한 조직 참여·수당 수령 자격 부여")}</label><button disabled={busy}>{tr("등급 생성")}</button><p>{tr("현재 등급: ")}{grades.map(g=>`${tr(g.name)}${g.reward_eligible ? " "+tr("(수당 참여)") : ""}`).join(" · ")}</p></form>
    <form className="shop-editor" onSubmit={e=>{e.preventDefault();setQuery(q);}}><label>{tr("회원 검색")}<input value={q} maxLength={150} onChange={e=>setQ(e.target.value)} /></label><button>{tr("검색")}</button></form><p>{tr("최근 회원 최대 100명 · 취소 완료 주문은 구매 합계에서 제외")}</p>
    {members.map(m=><article className="shop-order" key={m.id}><div><strong>{m.name}</strong><p>{m.email}</p><p>{tr(m.grade_name)}{tr(" · 유효 구매 ")}{formatUsdt(m.total_points,0)} P</p></div><button onClick={()=>{setSelected(m);setGrade(m.grade_code);setReason("");}}>{tr("등급 지정")}</button></article>)}
    {selected && <form className="shop-editor" onSubmit={e=>{e.preventDefault();void submit({action:"assign",userId:selected.id,gradeCode:grade,reason});}}><h2>{selected.name}{tr(" 등급 지정")}</h2><label>{tr("등급")}<select value={grade} onChange={e=>setGrade(e.target.value)}>{grades.map(g=><option value={g.code} key={g.code}>{tr(g.name)}</option>)}</select></label><label>{tr("변경 사유")}<input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label><button disabled={busy}>{tr("등급 저장")}</button><button type="button" onClick={()=>setSelected(null)}>{tr("닫기")}</button></form>}
  </main>;
}
