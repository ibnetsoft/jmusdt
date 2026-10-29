"use client";
import { useI18n } from "./i18n";
import { localeTags, type Locale } from "@/lib/i18n";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Clock3,
  Check,
  LoaderCircle,
  X,
} from "lucide-react";
import { useDialogFocus } from "./dialog-focus";
import { formatUsdt } from "@/lib/money";
import type { Transaction } from "@/lib/types";
export function Token({ small = false }: { small?: boolean }) {
  return (
    <span className={`token ${small ? "small" : ""}`} aria-label="USDT">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9 9h22v5H23v4c7 .3 12 1.5 12 3s-6.7 3-15 3-15-1.3-15-3 5-2.7 12-3v-4H9zm8 10v3h6v-3c5.2.3 9 1 9 2s-5.4 2-12 2-12-.9-12-2 3.8-1.7 9-2zm0 6h6v9h-6z"
        />
      </svg>
    </span>
  );
}
export function Brand({ admin = false }: { admin?: boolean }) {
  const { tr } = useI18n();
  return (
    <a className="brand" href={admin ? "/admin" : "/"} aria-label={tr("JMUSDT 홈")}>
      <span className="brand-mark">
        j<span>m</span>
        <i />
      </span>
      <span>
        JM<span className="muted">USDT</span>
        {admin ? <small>ADMIN CONSOLE</small> : null}
      </span>
    </a>
  );
}
export const kindLabels: Record<string, string> = {
  deposit: "USDT 입금",
  transfer_in: "회원 송금 받음",
  transfer_out: "회원에게 송금",
  withdrawal: "외부 지갑 출금",
  purchase: "쇼핑몰 상품 구매",
  refund: "상품 구매 환불",
  reward: "마케팅 리워드",
  reward_reversal: "취소 보상 회수·미수금",
  reward_recovery: "취소 보상 미수금 상계",
  swap_in: "전환 받음",
  swap_out: "전환 보냄",
};
export const statusLabels: Record<string, string> = {
  completed: "완료",
  pending: "승인 대기",
  approved: "승인 완료",
  signing: "전송 준비",
  broadcast: "체인 확인 중",
  rejected: "반려",
  failed: "실패",
};
export function Status({ value }: { value: string }) {
  const { tr } = useI18n();
  return (
    <span className={`status ${value}`}>
      <i />
      {tr(statusLabels[value]) || value}
    </span>
  );
}
export function txDate(value: string, locale: Locale = "ko") {
  return new Intl.DateTimeFormat(localeTags[locale], {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
export function ActivityList({
  transactions,
  onSelect,
}: {
  transactions: Transaction[];
  onSelect: (t: Transaction) => void;
}) {
  const { tr, locale } = useI18n();
  return transactions.length ? (
    <div className="activity-list">
      {transactions.map((t) => {
        const incoming =
          t.kind === "deposit" ||
          t.kind === "transfer_in" ||
          t.kind === "swap_in" ||
          t.kind === "refund" ||
          t.kind === "reward";
        return (
          <button
            className="activity-row"
            key={t.id}
            onClick={() => onSelect(t)}
          >
            <span className={`tx-icon ${incoming ? "incoming" : ""}`}>
              {incoming ? (
                <ArrowDownLeft size={19} />
              ) : t.kind === "withdrawal" ? (
                <ArrowUpRight size={19} />
              ) : (
                <ArrowRightLeft size={19} />
              )}
            </span>
            <span className="tx-description">
              <strong>{tr(kindLabels[t.kind])}</strong>
              <small>
                {txDate(t.created_at, locale)} · {tr(statusLabels[t.status]) || t.status}
              </small>
            </span>
            <span className={`tx-amount ${incoming ? "incoming" : ""}`}>
              <strong>
                {incoming ? "+" : "−"}
                {formatUsdt(t.amount, t.asset === "POINT" ? 0 : 2)}
              </strong>
              <small>{t.asset === "POINT" ? "P" : "USDT"}</small>
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <div className="empty">
      <Clock3 />
      <p>{tr("아직 거래 내역이 없습니다.")}</p>
      <small>{tr("입금하거나 송금하면 이곳에 표시됩니다.")}</small>
    </div>
  );
}
export function Notice({ message }: { message: string }) {
  const { tr } = useI18n();
  return (
    <div className="notice" role="status">
      <Check size={17} />
      {tr(message)}
    </div>
  );
}
export function Spinner() {
  const { tr } = useI18n();
  return (
    <div className="loading">
      <LoaderCircle className="spin" />
      <p>{tr("지갑을 불러오는 중…")}</p>
    </div>
  );
}
export function TransactionModal({
  transaction,
  onClose,
  network,
}: {
  transaction: Transaction;
  onClose: () => void;
  network: string;
}) {
  const { tr, locale } = useI18n();
  useDialogFocus(true);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-button modal-close"
          autoFocus
          onClick={onClose}
          aria-label={tr("닫기")}
        >
          <X size={20} />
        </button>
        <p className="eyebrow">TRANSACTION</p>
        <h2 id="tx-title">{tr(kindLabels[transaction.kind])}</h2>
        <div className="detail-amount">
          {formatUsdt(transaction.amount, transaction.asset === "POINT" ? 0 : 6)}{" "}
          <small>{transaction.asset === "POINT" ? "P" : "USDT"}</small>
        </div>
        <Status value={transaction.status} />
        <dl className="details">
          <div>
            <dt>{tr("거래 시각")}</dt>
            <dd>{txDate(transaction.created_at, locale)} KST</dd>
          </div>
          <div>
            <dt>{tr("수수료")}</dt>
            <dd>{formatUsdt(transaction.fee, 6)} USDT</dd>
          </div>
          <div>
            <dt>{tr("받는 곳")}</dt>
            <dd>{transaction.destination || tr("내 지갑")}</dd>
          </div>
          <div>
            <dt>{tr("거래 ID")}</dt>
            <dd>{transaction.id}</dd>
          </div>
          {transaction.note ? (
            <div>
              <dt>{tr("메모")}</dt>
              <dd>{transaction.note}</dd>
            </div>
          ) : null}
        </dl>
        {transaction.txid ? (
          <a
            className="primary button-link"
            target="_blank"
            rel="noreferrer"
            href={`https://${network === "nile" ? "nile." : ""}tronscan.org/#/transaction/${transaction.txid}`}
          >{tr("블록체인에서 확인 ")}<ArrowUpRight size={17} />
          </a>
        ) : null}
      </section>
    </div>
  );
}
