"use client";
import { useI18n } from "./i18n";

import { useRef, useState } from "react";
import type { DetailBlock } from "@/lib/product-content";
export function ImageUpload({
  onUploaded,
  onBusy,
  label,
}: {
  onUploaded: (url: string) => void;
  onBusy: (busy: boolean) => void;
  label: string;
}) {
  const { tr } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="image-uploader">
      <label>
        {tr(label)}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError("");
            if (file.size > 3 * 1024 * 1024) {
              setError("3MB 이하의 이미지를 선택해 주세요.");
              e.target.value = "";
              return;
            }
            setBusy(true);
            onBusy(true);
            try {
              const body = new FormData();
              body.append("file", file);
              const response = await fetch("/api/admin/products/upload", {
                method: "POST",
                body,
              });
              const data = await response.json();
              if (!response.ok)
                throw new Error(data.error || "이미지 업로드 실패");
              onUploaded(data.url);
            } catch (e) {
              setError(e instanceof Error ? e.message : "이미지 업로드 실패");
            } finally {
              setBusy(false);
              onBusy(false);
              if (input.current) input.current.value = "";
            }
          }}
        />
      </label>
      <small className="shop-muted">{tr("JPG·PNG·WebP, 최대 3MB. 업로드한 상품 이미지는 공개됩니다.")}</small>
      {busy && <p role="status">{tr("이미지 업로드 중…")}</p>}
      {tr(error) && (
        <p role="alert" className="shop-error">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
export function DetailEditor({
  blocks,
  onChange,
  onBusy,
}: {
  blocks: DetailBlock[];
  onChange: (blocks: DetailBlock[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { tr } = useI18n();
  function change(index: number, block: DetailBlock) {
    onChange(blocks.map((b, i) => (i === index ? block : b)));
  }
  function move(index: number, delta: number) {
    const next = [...blocks];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  }
  return (
    <section aria-label={tr("상세페이지 편집")}>
      <h3>{tr("상세페이지 구성 (")}{blocks.length}/30)</h3>
      <p className="shop-muted">{tr("제목·본문·이미지를 순서대로 추가하세요.")}</p>
      {blocks.map((block, index) => (
        <div className="detail-block-editor" key={index}>
          <div className="shop-section-head">
            <strong>
              {index + 1}.{" "}
              {block.type === "heading"
                ? tr("제목")
                : block.type === "text"
                  ? tr("본문")
                  : tr("이미지")}
            </strong>
            <div>
              <button
                type="button"
                disabled={index === 0}
                aria-label={tr("{0}번 블록 위로", {"0": index + 1})}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === blocks.length - 1}
                aria-label={tr("{0}번 블록 아래로", {"0": index + 1})}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onChange(blocks.filter((_, i) => i !== index))}
              >{tr("삭제")}</button>
            </div>
          </div>
          {block.type === "heading" ? (
            <label>{tr("제목")}<input
                required
                maxLength={200}
                value={block.text}
                onChange={(e) =>
                  change(index, { ...block, text: e.target.value })
                }
              />
            </label>
          ) : block.type === "text" ? (
            <label>{tr("본문")}<textarea
                required
                rows={5}
                maxLength={5000}
                value={block.text}
                onChange={(e) =>
                  change(index, { ...block, text: e.target.value })
                }
              />
            </label>
          ) : (
            <>
              <img
                src={block.url}
                alt={block.alt}
                referrerPolicy="no-referrer"
              />
              <label>{tr("이미지 대체 설명")}<input
                  maxLength={200}
                  value={block.alt}
                  onChange={(e) =>
                    change(index, { ...block, alt: e.target.value })
                  }
                />
              </label>
              <label>{tr("이미지 캡션")}<input
                  maxLength={500}
                  value={block.caption}
                  onChange={(e) =>
                    change(index, { ...block, caption: e.target.value })
                  }
                />
              </label>
            </>
          )}
        </div>
      ))}
      <div className="detail-editor-tools">
        <button
          type="button"
          disabled={blocks.length >= 30}
          onClick={() => onChange([...blocks, { type: "heading", text: "" }])}
        >{tr("+ 제목")}</button>
        <button
          type="button"
          disabled={blocks.length >= 30}
          onClick={() => onChange([...blocks, { type: "text", text: "" }])}
        >{tr("+ 본문")}</button>
      </div>
      {blocks.length < 30 && (
        <ImageUpload
          label="상세 이미지 추가"
          onBusy={onBusy}
          onUploaded={(url) =>
            onChange([
              ...blocks,
              { type: "image", url, alt: "상품 상세 이미지", caption: "" },
            ])
          }
        />
      )}
    </section>
  );
}
