import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("announcements require all languages and are inaccessible directly to browser roles", async () => {
 const db = new PGlite();
 try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE profiles(id uuid PRIMARY KEY);");
  await db.exec(await readFile(new URL("../supabase/migrations/20261102124029_announcements.sql",import.meta.url),"utf8"));
  const id=crypto.randomUUID(); await db.query("INSERT INTO profiles VALUES($1)",[id]);
  await assert.rejects(db.query("INSERT INTO announcements(title_ko,body_ko,title_en,body_en,title_ja,body_ja,created_by) VALUES('공지','내용','','Body','お知らせ','本文',$1)",[id]));
  await db.query("INSERT INTO announcements(title_ko,body_ko,title_en,body_en,title_ja,body_ja,created_by) VALUES('공지','내용','Notice','Body','お知らせ','本文',$1)",[id]);
  const row=(await db.query<{title_en:string}>("SELECT title_en FROM announcements")).rows[0];assert.equal(row.title_en,"Notice");
  await db.exec("SET ROLE authenticated");
  await assert.rejects(db.query("SELECT * FROM announcements"));
  await assert.rejects(db.query("INSERT INTO announcements(title_ko) VALUES('x')"));
  await db.exec("RESET ROLE");
 } finally { await db.close(); }
});

