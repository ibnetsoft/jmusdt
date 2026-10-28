import { z } from "zod";
export const rewardLabels = {
  referral: "추천리워드",
  sponsor: "후원리워드",
  mom: "맘리워드",
  lucky: "복주머니",
  treasure: "보물주머니",
  daily: "데일리수당",
} as const;
export type RewardPlan = {
  referral: string;
  sponsor: string;
  mom: string;
  daily: string;
  days: number;
  lucky: number;
  treasure: number;
};
export const zeroPlan: RewardPlan = {
  referral: "0",
  sponsor: "0",
  mom: "0",
  daily: "0",
  days: 0,
  lucky: 0,
  treasure: 0,
};
const amount = z.string().regex(/^\d{1,10}(\.\d{1,6})?$/);
export const rewardPlanInput = z
  .object({
    referral: amount,
    sponsor: amount,
    mom: amount,
    daily: amount,
    days: z.number().int().min(0).max(365),
    lucky: z.number().int().min(0).max(1000000),
    treasure: z.number().int().min(0).max(1000000),
  })
  .strict();
export function planUnits(plan: RewardPlan): RewardPlan {
  const units = (s: string) => {
    const [a, b = ""] = s.split(".");
    return (BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"))).toString();
  };
  return {
    ...plan,
    referral: units(plan.referral),
    sponsor: units(plan.sponsor),
    mom: units(plan.mom),
    daily: units(plan.daily),
  };
}
export function planBudget(p: RewardPlan) {
  return (
    BigInt(p.referral) +
    BigInt(p.sponsor) +
    BigInt(p.mom) +
    BigInt(p.daily) * BigInt(p.days)
  );
}
