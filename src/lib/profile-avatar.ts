import sharp from "sharp";
export const MAX_AVATAR_INPUT = 3 * 1024 * 1024;
export async function normalizeAvatar(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_AVATAR_INPUT) throw new Error("이미지는 3MB 이하로 선택해 주세요.");
  try {
    const image = sharp(bytes, { limitInputPixels: 25000000, failOn: "warning", animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "gif", "heif"].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error("Invalid image");
    const output = await image.rotate().resize(256, 256, {fit:"cover"}).webp({quality:82}).toBuffer();
    if (output.length > 262144) throw new Error("Image too large");
    return output;
  } catch {
    throw new Error("이미지를 읽을 수 없습니다. JPG, PNG, WebP 등의 정지 이미지를 선택해 주세요.");
  }
}
