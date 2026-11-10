import {test,expect} from '@playwright/test';

test('Jinmu purchase displays the fixed company address and submits an internal payment',async({page})=>{
 const company='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
 const wallet={mode:'live',user:{id:'test',name:'회원',email:'a@example.com',status:'active'},available:'123000000',points:'0',reserved:'0',address:'TTESTADDRESS',companyAddress:company,network:'mainnet',fee:'1000000',minimum:'10000000',transactions:[]};
 let submitted:any;
 await page.route('**/api/session',r=>r.fulfill({json:{userId:'test'}}));
 await page.route('**/api/wallet',r=>r.fulfill({json:wallet}));
 await page.route('**/api/wallet/send',r=>{submitted=r.request().postDataJSON(); return r.fulfill({json:{id:'test'}})});
 await page.setViewportSize({width:320,height:844}); await page.goto('/');
 await page.getByRole('button',{name:'이체',exact:true}).click();
 await page.getByRole('button',{name:'진무 상품 구매',exact:true}).click();
 const address=page.locator('.send-view input[readonly]'); await expect(address).toHaveValue(company);
 await page.getByRole('textbox',{name:'송금 금액'}).fill('10');
 await expect(page.getByRole('button',{name:'송금 정보 확인'})).toBeEnabled();
 await page.getByRole('button',{name:'송금 정보 확인'}).click();
 await expect(page.getByText('앱 잔액에서 결제됩니다. 실제 USDT는 관리자가 별도로 모읍니다.')).toHaveCount(0);
 await page.getByRole('button',{name:'결제하기'}).click();
 await expect(page.getByText('구매 결제 완료.')).toBeVisible();
 expect(submitted).toMatchObject({kind:'jinmu',recipient:company,amount:'10'});
});
