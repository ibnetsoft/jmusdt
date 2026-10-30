"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { getAdminData, fetchAdminData, clearAdminData } from "@/lib/admin-preload";
import "./shop.css";
export function ExchangeRateAdmin() {
 const {tr}=useI18n(); const cached=getAdminData<{rate:number;version:number}>("/api/admin/exchange-rate"); const [rate,setRate]=useState(() => cached ? String(cached.rate) : ""),[version,setVersion]=useState(() => cached?.version ?? 0),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{fetchAdminData("/api/admin/exchange-rate").then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setRate(String(d.rate));setVersion(d.version)}).catch(e=>setError(e.message));},[]);
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");setMessage("");try{const r=await fetch("/api/admin/exchange-rate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rate:Number(rate),version})});const d=await r.json();if(!r.ok)throw new Error(d.error);clearAdminData();setRate(String(d.rate));setVersion(d.version);setMessage("전환 비율을 저장했습니다.");}catch(e){setError(e instanceof Error?e.message:"저장 실패")}finally{setBusy(false)}}
 return <main className="commerce admin-rate-page"><header><Link href="/admin">{tr("← 관리자")}</Link></header><h1>{tr("포인트 전환 비율")}</h1><form className="shop-editor admin-rate-form" onSubmit={save}><h2>{tr("전환 비율 설정")}</h2><label htmlFor="admin-exchange-rate">{tr("1 USDT당 포인트")}</label><div className="admin-rate-input"><span>1 USDT</span><span aria-hidden="true">=</span><input id="admin-exchange-rate" type="number" inputMode="numeric" min="1" max="1000000" step="1" required value={rate} onChange={e=>setRate(e.target.value)} /><span>P</span></div><button disabled={busy || !version}>{tr("저장")}</button></form>{error && <p role="alert">{tr(error)}</p>}{message && <p role="status">{tr(message)}</p>}</main>;
}
