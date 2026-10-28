import type { DetailBlock } from "@/lib/product-content";
export function DetailContent({
  description,
  blocks = [],
}: {
  description: string;
  blocks?: DetailBlock[];
}) {
  return (
    <div className="product-content">
      {description && <p className="shop-description">{description}</p>}
      {blocks.map((block, index) =>
        block.type === "heading" ? (
          <h3 key={index}>{block.text}</h3>
        ) : block.type === "text" ? (
          <p className="shop-description" key={index}>
            {block.text}
          </p>
        ) : (
          <figure key={index}>
            <img
              src={block.url}
              alt={block.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            {block.caption && <figcaption>{block.caption}</figcaption>}
          </figure>
        ),
      )}
    </div>
  );
}
