import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeBrandImage } from "../src/lib/brand-image";
test("brand upload accepts genuine PNG, preserves transparency and rejects non-PNG data",async()=>{
 const input=await sharp({create:{width:16,height:16,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
 const meta=await sharp(await normalizeBrandImage(input)).metadata();
 assert.equal(meta.format,"png");assert.equal(meta.hasAlpha,true);
 const jpeg=await sharp({create:{width:8,height:8,channels:3,background:"white"}}).jpeg().toBuffer();
 await assert.rejects(normalizeBrandImage(jpeg));
 await assert.rejects(normalizeBrandImage(Buffer.alloc(1048577)));
});
