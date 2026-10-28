"use client";
import { useState } from "react";
import "./shop.css";
export function BrandingAdmin() {
  const [file,setFile]=useState<File|null>(null),[version,setVersion]=useState(Date.now()),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function upload(e:React.FormEvent) {e.preventDefault();if(!file||busy)return;setBusy(true);setMessage("");try{const body=new FormData();body.append("file",file);const r=await fetch("/api/admin/branding",{method:"POST",body});const d=await r.json();if(!r.ok)throw new Error(d.error);setVersion(Date.now());setFile(null);setMessage("로고를 저장했습니다. 다른 화면을 새로고침하면 적용됩니다.");}catch(e){setMessage(e instanceof Error?e.message:"업로드 실패");}finally{setBusy(false);}}
  return <main className="commerce"><header><a href="/admin">← 관리자 콘솔</a></header><p className="shop-kicker">ADMIN / BRAND</p><h1>로고 설정</h1><p>PNG 이미지를 등록하면 회원·관리자 화면 상단에 적용됩니다. 투명 배경을 사용할 수 있습니다.</p><form className="shop-editor" onSubmit={upload}><label>PNG 로고 파일 (최대 1MB)<input key={version} type="file" accept="image/png" required onChange={e=>setFile(e.target.files?.[0]||null)} /></label><button disabled={busy||!file}>{busy?"저장 중…":"로고 저장"}</button></form>{message&&<p role="status">{message}</p>}<h2>현재 로고</h2><img src={`/api/branding/logo?v=${version}`} alt="등록된 로고" style={{maxWidth:240,maxHeight:120,objectFit:"contain"}} onError={e=>{e.currentTarget.style.display="none";}} onLoad={e=>{e.currentTarget.style.display="block";}} /></main>;
}
