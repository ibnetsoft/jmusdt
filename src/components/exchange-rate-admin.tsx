"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import "./shop.css";
export function ExchangeRateAdmin() {
 const {tr}=useI18n(); const [rate,setRate]=useState(""),[version,setVersion]=useState(0),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch("/api/admin/exchange-rate",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setRate(String(d.rate));setVersion(d.version)}).catch(e=>setError(e.message));},[]);
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");setMessage("");try{const r=await fetch("/api/admin/exchange-rate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rate:Number(rate),version})});const d=await r.json();if(!r.ok)throw new Error(d.error);setRate(String(d.rate));setVersion(d.version);setMessage("전환 비율을 저장했습니다.");}catch(e){setError(e instanceof Error?e.message:"저장 실패")}finally{setBusy(false)}}
 return <main className="commerce"><header><Link href="/admin">{tr("← 관리자")}</Link></header><h1>{tr("포인트 전환 비율")}</h1><form className="shop-editor" onSubmit={save}><label>1 USDT = <input type="number" inputMode="numeric" min="1" max="1000000" step="1" required value={rate} onChange={e=>setRate(e.target.value)} /> P</label><button disabled={busy || !version}>{tr("저장")}</button></form>{error && <p role="alert">{tr(error)}</p>}{message && <p role="status">{tr(message)}</p>}</main>;
}
