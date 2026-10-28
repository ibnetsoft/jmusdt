import sharp from "sharp";
export const MAX_PRODUCT_IMAGE = 3 * 1024 * 1024;
export async function normalizeProductImage(bytes: Buffer, mime: string) {
  if (bytes.length === 0 || bytes.length > MAX_PRODUCT_IMAGE)
    throw new Error("이미지는 3MB 이하로 선택해 주세요.");
  const formats: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!formats[mime])
    throw new Error("JPG·PNG·WebP 이미지만 업로드할 수 있습니다.");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 40000000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (metadata.format !== formats[mime] || (metadata.pages || 1) > 1)
      throw new Error("Invalid image");
    const result = await image
      .rotate()
      .resize({
        width: 2000,
        height: 6000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    if (result.length > MAX_PRODUCT_IMAGE) throw new Error("Output too large");
    return result;
  } catch {
    throw new Error(
      "이미지를 읽을 수 없습니다. 4천만 화소 이하의 정지 이미지를 사용해 주세요.",
    );
  }
}
