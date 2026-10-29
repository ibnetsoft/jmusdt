import { getImageProps } from "next/image";

export const productImageSizes = "(max-width: 600px) 50vw, 300px";
const loadingImages = new Set<HTMLImageElement>();

export function isManagedProductImage(src: string): boolean {
  try {
    const url = new URL(src);
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.protocol === "https:" && url.origin === origin.origin && !url.search && url.pathname.startsWith("/storage/v1/object/public/product-images/");
  } catch { return false; }
}

// Use the same responsive source and sizes as the product card so the browser
// can reuse the image it downloads before the shop is opened.
export function preloadProductImages(products: unknown): void {
  if (typeof window === "undefined" || !Array.isArray(products)) return;
  const urls = new Set<string>();
  for (const item of products) {
    const src = item?.image_url;
    if (typeof src !== "string" || !src || urls.has(src)) continue;
    try {
      const url = new URL(src);
      if (url.protocol !== "https:") continue;
      urls.add(src);
      const image = new window.Image();
      loadingImages.add(image);
      image.onload = image.onerror = () => { loadingImages.delete(image); };
      if (isManagedProductImage(src)) {
        try {
          const { props } = getImageProps({ src, alt: "", width: 600, height: 600, sizes: productImageSizes });
          image.sizes = productImageSizes;
          image.srcset = props.srcSet || "";
          image.src = props.src;
        } catch { image.src = src; }
      } else {
        image.referrerPolicy = "no-referrer";
        image.src = src;
      }
    } catch { /* A malformed image must not block page preloading. */ }
  }
}
