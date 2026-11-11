"use client";
// Resize on the device so ordinary camera photos fit the upload limit and
// image metadata is not sent with the profile picture.
export async function prepareProfilePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해 주세요.");
  if (file.size > 20 * 1024 * 1024) throw new Error("이미지는 20MB 이하로 선택해 주세요.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error("이미지를 읽을 수 없습니다.")); image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) throw new Error("이미지를 읽을 수 없습니다.");
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d"); if (!context) throw new Error("이미지를 읽을 수 없습니다.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0, 0, 256, 256);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("이미지를 읽을 수 없습니다.")), "image/webp", 0.82));
  } finally { URL.revokeObjectURL(url); }
}
