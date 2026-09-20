/**
 * Accounting policy, not an authentication or payment-proof verifier.
 * A future provider adapter must authenticate the producer, resolve ownership,
 * and verify purchase evidence before setting purchaseVerified. Never expose
 * this input as a browser-write API or derive it from an aggregate balance.
 */
export const PAID_PLAY_RULE = "purchased-consumption-v1" as const;

export interface PaidPlayAllocation {
  id: string;
  unit: string;
  /** Only purchased is eligible; additional categories default to excluded. */
  funding: string;
  /** Set only by a trusted provider adapter after verifying the payment. */
  purchaseVerified?: boolean;
  consumed: number;
  /** Cumulative reversal of consumption on this allocation, not wallet credits. */
  refunded: number;
}

export interface PaidPlayReceipt {
  state: "pending" | "settled" | "released";
  unit: string;
  allocations: PaidPlayAllocation[];
}

export interface PaidPlayContribution {
  rule: typeof PAID_PLAY_RULE;
  /** Provider-specific integer atomic unit; no implicit cross-provider conversion. */
  unit: string;
  consumed: number;
  refunded: number;
  qualifying: number;
  excluded: number;
}

const invalid = (): never => { throw new Error("paid_play_input"); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) return invalid();
  return value;
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function add(left: number, right: number): number {
  if (right > Number.MAX_SAFE_INTEGER - left) return invalid();
  return left + right;
}

/**
 * Evaluate one complete receipt snapshot. Refunds are cumulative per allocation.
 * Revisions replace the previous contribution; callers must not add every retry.
 * Unknown/new funding categories fail closed until explicitly certified.
 */
export function evaluatePaidPlay(input: unknown): PaidPlayContribution {
  const receipt = record(input);
  const unit = identifier(receipt.unit);
  if (receipt.state !== "pending" && receipt.state !== "settled" && receipt.state !== "released") return invalid();
  if (!Array.isArray(receipt.allocations) || receipt.allocations.length > 1000) return invalid();
  const seen = new Set<string>();
  const result: PaidPlayContribution = {
    rule: PAID_PLAY_RULE, unit, consumed: 0, refunded: 0, qualifying: 0, excluded: 0,
  };
  for (const value of receipt.allocations) {
    const allocation = record(value);
    const id = identifier(allocation.id);
    if (seen.has(id) || allocation.unit !== unit) return invalid();
    seen.add(id);
    const funding = identifier(allocation.funding);
    const consumed = amount(allocation.consumed);
    const refunded = amount(allocation.refunded);
    if (refunded > consumed) return invalid();
    result.consumed = add(result.consumed, consumed);
    result.refunded = add(result.refunded, refunded);
    const net = consumed - refunded;
    if (funding === "purchased" && allocation.purchaseVerified === true) {
      result.qualifying = add(result.qualifying, net);
    } else {
      result.excluded = add(result.excluded, net);
    }
  }
  // Validate all allocations even when the reservation is not finalized.
  if (receipt.state !== "settled") {
    result.consumed = result.refunded = result.qualifying = result.excluded = 0;
  }
  return result;
}
