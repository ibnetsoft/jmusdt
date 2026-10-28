import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  normalizeProductImage,
  MAX_PRODUCT_IMAGE,
} from "../src/lib/product-image";
import { detailBlocksSchema } from "../src/lib/product-content";
test("product uploads decode actual raster images, strip metadata and reject invalid formats", async () => {
  const png = await sharp({
    create: { width: 20, height: 10, channels: 3, background: "#ef3035" },
  })
    .png()
    .toBuffer();
  const output = await normalizeProductImage(png, "image/png");
  const info = await sharp(output).metadata();
  assert.equal(info.format, "webp");
  assert.equal(info.width, 20);
  assert.equal(info.exif, undefined);
  await assert.rejects(normalizeProductImage(png, "image/jpeg"));
  await assert.rejects(
    normalizeProductImage(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "image/png",
    ),
  );
  await assert.rejects(normalizeProductImage(png, "image/svg+xml"));
  await assert.rejects(
    normalizeProductImage(Buffer.alloc(MAX_PRODUCT_IMAGE + 1), "image/png"),
  );
});
test("detail content accepts ordered safe blocks and rejects executable URLs and oversized documents", () => {
  assert.ok(
    detailBlocksSchema.safeParse([
      { type: "heading", text: "Details" },
      { type: "text", text: "<script>literal text</script>" },
      {
        type: "image",
        url: "https://example.com/image.webp",
        alt: "Product",
        caption: "Photo",
      },
    ]).success,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:image/svg+xml,xx",
    "http://example.com/x",
  ])
    assert.equal(
      detailBlocksSchema.safeParse([
        { type: "image", url, alt: "", caption: "" },
      ]).success,
      false,
    );
  assert.equal(
    detailBlocksSchema.safeParse(
      Array.from({ length: 31 }, () => ({ type: "text", text: "x" })),
    ).success,
    false,
  );
  assert.equal(
    detailBlocksSchema.safeParse([{ type: "html", html: "<script/>" }]).success,
    false,
  );
});
