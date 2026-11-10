import {test,expect} from '@playwright/test';
test('admin reviews Jinmu-only collection within the purchase balance',async({page})=>{
 const id='00000000-0000-4000-8000-000000000001';let requested:any;
 const data={jinmu:{sales:'120000000',collected:'20000000',reserved:'10000000',available:'90000000'},wallets:[{user_id:id,address:'Tmember',name:'회원',email:'test@example.com',status:'active',usdt:'150000000',trx:'2000000',error:''}],settings:{enabled:true,max_topup:'25000000',company_reserve:'50000000',version:1},config:{network:'mainnet',contract:'contract',company:'Tcompany',feeLimit:100000000,issues:[]},count:1,jobs:[],jobCount:0,canExecute:true,health:{last_seen:new Date().toISOString(),last_error:''},companyTrx:'100000000',companyError:''};
 await page.route('**/api/admin/sweeps?**',r=>r.fulfill({json:data}));
 await page.route('**/api/admin/sweeps',r=>{requested=r.request().postDataJSON();return r.fulfill({json:{id:'review',token:'t',purpose:'jinmu',network:'mainnet',company:'Tcompany',companyTrx:'100000000',reserve:'50000000',totalFunding:'0',expiresAt:new Date(Date.now()+300000).toISOString(),issues:[],enabled:true,items:[{userId:id,source:'Tmember',amount:'90000000',sourceTrx:'2000000',topup:'0',feeLimit:'100000000'}]}})});
 await page.goto('/admin/sweeps');await expect(page.getByText('회수 가능 구매금')).toBeVisible();
 await page.getByRole('checkbox',{name:'test@example.com 선택'}).check();
 await page.getByRole('button',{name:'선택 지갑으로 진무 구매금 모으기 검토'}).click();
 await expect(page.getByRole('heading',{name:'진무 구매금 모으기 최종 검토'})).toBeVisible();
 await expect(page.getByText('90.000000 USDT → 회사')).toBeVisible();
 expect(requested).toEqual({action:'review_jinmu',userIds:[id]});
});
