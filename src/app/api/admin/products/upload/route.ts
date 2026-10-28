import { api, identity, checkOrigin, HttpError } from "@/lib/http";
import { authClient } from "@/lib/supabase";
import { database } from "@/lib/db";
import { normalizeProductImage } from "@/lib/product-image";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity(true);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new HttpError(400, "이미지 파일을 선택해 주세요.");
    if (!request.body) throw new HttpError(400, "파일이 없습니다.");
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new HttpError(
            413,
            "업로드 요청이 너무 큽니다. 이미지는 3MB 이하로 선택해 주세요.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let file: FormDataEntryValue | null;
    try {
      file = (
        await new Response(Buffer.concat(chunks), {
          headers: { "Content-Type": request.headers.get("content-type")! },
        }).formData()
      ).get("file");
    } catch {
      throw new HttpError(400, "업로드 요청을 확인해 주세요.");
    }
    if (!(file instanceof File))
      throw new HttpError(400, "파일을 선택해 주세요.");
    let image: Buffer;
    try {
      image = await normalizeProductImage(
        Buffer.from(await file.arrayBuffer()),
        file.type,
      );
    } catch (e) {
      throw new HttpError(
        400,
        e instanceof Error ? e.message : "이미지 확인 실패",
      );
    }
    const client = await authClient(),
      path = `${user.id}/${crypto.randomUUID()}.webp`;
    const { error } = await client.storage
      .from("product-images")
      .upload(path, image, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) {
      console.error("Product image upload failed", error.name);
      throw new HttpError(
        503,
        "이미지 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    await database().query(
      "INSERT INTO audit_logs(actor,action,details) VALUES($1,'product.image_uploaded',$2)",
      [user.id, JSON.stringify({ path, bytes: image.length })],
    );
    return {
      url: client.storage.from("product-images").getPublicUrl(path).data
        .publicUrl,
    };
  });
}
