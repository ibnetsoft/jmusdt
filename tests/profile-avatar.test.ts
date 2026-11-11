import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {PGlite} from '@electric-sql/pglite';
import {normalizeAvatar, MAX_AVATAR_INPUT} from '../src/lib/profile-avatar';

test('avatar upload normalizes and validates image data',async()=>{
 const input=await sharp({create:{width:800,height:400,channels:3,background:'#519f85'}}).jpeg().toBuffer();
 const image=await normalizeAvatar(input),meta=await sharp(image).metadata();
 assert.equal(meta.format,'webp');assert.equal(meta.width,256);assert.equal(meta.height,256);
 await assert.rejects(normalizeAvatar(Buffer.from('not an image')),/이미지를 읽을 수 없습니다/);
 await assert.rejects(normalizeAvatar(Buffer.alloc(MAX_AVATAR_INPUT+1)),/3MB/);
});
test('profile avatar storage is private and one image per account',async()=>{
 const db=new PGlite();const one=crypto.randomUUID(),two=crypto.randomUUID();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE profiles(id uuid PRIMARY KEY)');
  await db.exec(await readFile(new URL('../supabase/migrations/20261111000000_profile_avatars.sql',import.meta.url),'utf8'));
  await db.query('INSERT INTO profiles VALUES($1),($2)',[one,two]);
  const image=await normalizeAvatar(await sharp({create:{width:5,height:8,channels:3,background:'#123456'}}).png().toBuffer());
  const upsert=(id:string)=>db.query<any>('INSERT INTO profile_avatars(user_id,image) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET image=EXCLUDED.image,version=gen_random_uuid(),updated_at=now() RETURNING version::text',[id,image]);
  const first=(await upsert(one)).rows[0].version;const second=(await upsert(one)).rows[0].version;await upsert(two);
  assert.notEqual(first,second);assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM profile_avatars')).rows[0].n,2);
  const rights=(await db.query<any>("SELECT has_table_privilege('anon','profile_avatars','SELECT') AS anon,has_table_privilege('authenticated','profile_avatars','SELECT') AS authenticated")).rows[0];
  assert.equal(rights.anon,false);assert.equal(rights.authenticated,false);
  assert.equal((await db.query<any>("SELECT relrowsecurity FROM pg_class WHERE oid='profile_avatars'::regclass")).rows[0].relrowsecurity,true);
 }finally{await db.close()}
});
