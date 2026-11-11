import {test,expect} from '@playwright/test';
import sharp from 'sharp';

test('member selects a profile photo and sees it at the right end of the wallet card',async({page})=>{
 const image=await sharp({create:{width:100,height:100,channels:3,background:'#ff0088'}}).png().toBuffer();
 const version='bda574cc-03ce-4eb1-8395-b9467eba319a';let stored='';let uploads=0;
 const wallet=()=>({mode:'live',user:{id:'test',name:'테스트 회원',email:'test@example.com',status:'active',avatarVersion:stored},available:'0',points:'0',reserved:'0',address:'TTESTADDRESS',network:'mainnet',fee:'1000000',minimum:'10000000',transactions:[],packages:{lucky:'1',treasure:'2'}});
 await page.route('**/api/session',r=>r.fulfill({json:{userId:'test'}}));
 await page.route('**/api/wallet',r=>r.fulfill({json:wallet()}));
 await page.route('**/api/profile/avatar?**',r=>r.fulfill({body:image,contentType:'image/png'}));
 await page.route('**/api/profile/avatar',r=>{uploads++;stored=version;return r.fulfill({json:{version}})});
 await page.setViewportSize({width:320,height:844});await page.goto('/');
 await page.getByRole('button',{name:'프로필 설정'}).click();
 const edit=page.getByRole('button',{name:'프로필 사진 변경'});await expect(edit).toBeVisible();
 await page.locator('input[type=file]').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:image});
 await expect(edit.locator('img')).toBeVisible();await expect(edit.locator('img')).toHaveAttribute('src',`/api/profile/avatar?v=${version}`);
 await page.getByRole('link',{name:'지갑',exact:true}).click();
 const portrait=page.getByRole('button',{name:'프로필 설정'});await expect(portrait.locator('img')).toBeVisible();
 const [row,box]=await Promise.all([page.locator('.asset-meta').boundingBox(),portrait.boundingBox()]);
 expect(row).toBeTruthy();expect(box).toBeTruthy();expect(Math.abs((row!.x+row!.width)-(box!.x+box!.width))).toBeLessThan(2);
 expect(box!.y).toBeGreaterThanOrEqual(row!.y);expect(box!.y+box!.height).toBeLessThanOrEqual(row!.y+row!.height+1);
 expect(uploads).toBe(1);await page.reload();await expect(page.getByRole('button',{name:'프로필 설정'}).locator('img')).toBeVisible();
});

test('demo photo can be selected and remains visible after reload',async({page})=>{
 const image=await sharp({create:{width:600,height:400,channels:3,background:'#2288aa'}}).png().toBuffer();
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'프로필 설정'}).click();
 await page.locator('input[type=file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:image});
 await expect(page.getByRole('button',{name:'프로필 사진 변경'}).locator('img')).toHaveAttribute('src',/^data:image\//);
 await page.getByRole('link',{name:'지갑',exact:true}).click();
 await expect(page.getByRole('button',{name:'프로필 설정'}).locator('img')).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'프로필 설정'}).locator('img')).toBeVisible();
});
