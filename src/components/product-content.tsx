"use client";
import { useI18n } from "./i18n";
import type { DetailBlock } from "@/lib/product-content";
export function DetailContent({
  description,
  blocks = [],
}: {
  description: string;
  blocks?: DetailBlock[];
}) {
  const { tr } = useI18n();
  return (
    <div className="product-content">
      {description && <p className="shop-description">{tr(description)}</p>}
      {blocks.map((block, index) =>
        block.type === "heading" ? (
          <h3 key={index}>{tr(block.text)}</h3>
        ) : block.type === "text" ? (
          <p className="shop-description" key={index}>
            {tr(block.text)}
          </p>
        ) : (
          <figure key={index}>
            <img
              src={block.url}
              alt={tr(block.alt)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            {block.caption && <figcaption>{tr(block.caption)}</figcaption>}
          </figure>
        ),
      )}
    </div>
  );
}
