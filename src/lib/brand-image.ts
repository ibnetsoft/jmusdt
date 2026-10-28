import sharp from "sharp";
export async function normalizeBrandImage(input:Buffer):Promise<Buffer> {
  if(input.length>1048576) throw new Error("too large");
  const meta=await sharp(input,{limitInputPixels:4000000,animated:true}).metadata();
  if(meta.format!=="png" || (meta.pages||1)!==1) throw new Error("invalid PNG");
  const output=await sharp(input,{limitInputPixels:4000000}).rotate().resize({width:1000,height:1000,fit:"inside",withoutEnlargement:true}).png().toBuffer();
  if(output.length>1048576) throw new Error("too large");
  return output;
}
