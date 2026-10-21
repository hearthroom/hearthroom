export interface AnalyticsIdentity { userId: string; payerType: "none" | "topup" | "plan" }
/** Reject raw account IDs, UUIDs and unexpected fields at both transport boundaries. */
export function analyticsIdentity(value: unknown): AnalyticsIdentity | null {
  if (!value || typeof value !== "object") return null;
  const { userId, payerType } = value as Record<string, unknown>;
  return typeof userId === "string" && /^ga1_[a-f0-9]{64}$/.test(userId) &&
    ["none", "topup", "plan"].includes(String(payerType))
    ? { userId, payerType: payerType as AnalyticsIdentity["payerType"] } : null;
}
export const validClientId = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,20}\.[0-9]{1,20}$/.test(value);
