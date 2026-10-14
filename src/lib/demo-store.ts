"use client";
import { demoAdmin, demoWallet } from "./demo";
import type { AdminData, WalletData } from "./types";
import { parseUsdt } from "./money";
const KEY = "jmusdt.demo.v1";
export function readDemo(): AdminData {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const value = JSON.parse(saved);
      if (
        value.mode === "demo" &&
        Array.isArray(value.users) &&
        Array.isArray(value.transactions) &&
        Array.isArray(value.withdrawals) &&
        Array.isArray(value.audit)
      )
        return value;
    }
  } catch {}
  return structuredClone(demoAdmin);
}
function saveDemo(data: AdminData) {
  localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("jmusdt-demo"));
}
export function demoSnapshot(): WalletData {
  const store = readDemo(),
    user = store.users[0];
  return {
    ...demoWallet,
    available: user.available,
    reserved: user.reserved,
    user: { ...demoWallet.user, status: user.status },
    transactions: store.transactions.filter((t) => t.email === user.email),
  };
}
export function resetDemo() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("jmusdt-demo"));
}
export function demoSend(
  kind: "internal" | "external",
  recipient: string,
  amount: string,
  key: string,
) {
  const store = readDemo(),
    user = store.users[0];
  if (store.transactions.some((t) => t.id === key)) return;
  if (user.status !== "active") throw new Error("이용이 제한된 계정입니다.");
  const units = parseUsdt(amount),
    fee = kind === "external" ? 1000000n : 0n,
    total = units + fee;
  if (kind === "external" && units < 10000000n)
    throw new Error("최소 출금 금액은 10 USDT입니다.");
  if (total > BigInt(user.available))
    throw new Error("사용 가능한 잔액이 부족합니다.");
  const target = store.users.find(
    (u) => u.email === recipient.trim().toLowerCase(),
  );
  if (
    kind === "internal" &&
    (!target || target.id === user.id || target.status !== "active")
  )
    throw new Error("데모 회원 min@example.com으로 송금해 주세요.");
  user.available = (BigInt(user.available) - total).toString();
  const entry = {
    id: key,
    kind:
      kind === "internal" ? ("transfer_out" as const) : ("withdrawal" as const),
    amount: units.toString(),
    fee: fee.toString(),
    status: kind === "internal" ? "completed" : "pending",
    destination: recipient,
    created_at: new Date().toISOString(),
    email: user.email,
  };
  store.transactions.unshift(entry);
  if (kind === "external") {
    user.reserved = (BigInt(user.reserved) + total).toString();
    store.withdrawals.unshift({ ...entry, user_id: user.id });
  } else if (target) {
    target.available = (BigInt(target.available) + units).toString();
    store.transactions.unshift({
      ...entry,
      id: crypto.randomUUID(),
      kind: "transfer_in",
      destination: user.email,
      email: target.email,
    });
  }
  saveDemo(store);
}
export function demoAdminAction(action: string, id: string, reason: string) {
  const store = readDemo();
  if (action === "approve" || action === "reject") {
    const entry = store.withdrawals.find((t) => t.id === id);
    if (!entry || entry.status !== "pending")
      throw new Error("이미 처리된 출금입니다.");
    entry.status = action === "approve" ? "approved" : "rejected";
    entry.note = reason;
    const history = store.transactions.find((t) => t.id === id);
    if (history) {
      history.status = entry.status;
      history.note = reason;
    }
    if (action === "reject") {
      const user = store.users.find((u) => u.id === entry.user_id)!;
      const total = BigInt(entry.amount) + BigInt(entry.fee);
      user.reserved = (BigInt(user.reserved) - total).toString();
      user.available = (BigInt(user.available) + total).toString();
    }
  } else if (action === "block" || action === "unblock") {
    const user = store.users.find((u) => u.id === id);
    if (user) user.status = action === "block" ? "blocked" : "active";
  }
  store.audit.unshift({
    id: crypto.randomUUID(),
    actor: "demo-admin",
    action,
    created_at: new Date().toISOString(),
    details: { id, reason },
  });
  saveDemo(store);
}
