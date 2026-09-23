import { describe, expect, it } from "vitest";
import { evaluatePaidPlay } from "../src/community/paid-play";

const purchased = (consumed = 70, refunded = 0) => ({
  id: "paid-lot", unit: "harbor-credit-v1", funding: "purchased",
  purchaseVerified: true, consumed, refunded,
});
const gift = (consumed = 30, refunded = 0) => ({
  id: "gift-lot", unit: "harbor-credit-v1", funding: "gift",
  consumed, refunded,
});
const receipt = (allocations: unknown[] = [purchased(), gift()]) => ({
  state: "settled", unit: "harbor-credit-v1", allocations,
});

describe("purchased-credit consumption policy", () => {
  it("counts only purchased allocations of a mixed settled deduction", () => {
    expect(evaluatePaidPlay(receipt())).toEqual({
      rule: "purchased-consumption-v1", unit: "harbor-credit-v1",
      consumed: 100, refunded: 0, qualifying: 70, excluded: 30,
    });
  });

  it("does not subtract a gift refund from purchased consumption", () => {
    expect(evaluatePaidPlay(receipt([purchased(), gift(30, 20)])))
      .toMatchObject({ consumed: 100, refunded: 20, qualifying: 70, excluded: 10 });
  });

  it("subtracts refunds from the purchased allocation they reverse", () => {
    expect(evaluatePaidPlay(receipt([purchased(70, 15), gift(30, 20)])))
      .toMatchObject({ qualifying: 55, excluded: 10, refunded: 35 });
  });

  it("counts zero after a full reversal", () => {
    expect(evaluatePaidPlay(receipt([purchased(70, 70), gift(30, 30)])))
      .toMatchObject({ qualifying: 0, excluded: 0, refunded: 100 });
  });

  it.each(["gift", "bonus", "promotion", "compensation", "trial", "subscription", "unknown", "future-free-source"])(
    "does not count %s, even if its purchase flag is true", (funding) => {
      expect(evaluatePaidPlay(receipt([{ ...purchased(), funding }])))
        .toMatchObject({ qualifying: 0, excluded: 70 });
    },
  );

  it.each([undefined, false, "true", 1])("requires explicit verified purchase evidence (%s)", (purchaseVerified) => {
    expect(evaluatePaidPlay(receipt([{ ...purchased(), purchaseVerified }])))
      .toMatchObject({ qualifying: 0, excluded: 70 });
  });

  it.each(["pending", "released"])("does not award unfinalized %s allocations", (state) => {
    expect(evaluatePaidPlay({ ...receipt(), state }))
      .toMatchObject({ consumed: 0, refunded: 0, qualifying: 0, excluded: 0 });
  });

  it("accepts a finalized zero deduction without inventing progress", () => {
    expect(evaluatePaidPlay(receipt([])))
      .toMatchObject({ consumed: 0, refunded: 0, qualifying: 0, excluded: 0 });
  });

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", null])(
    "rejects invalid atomic amounts (%s)", (consumed) => {
      expect(() => evaluatePaidPlay(receipt([{ ...purchased(), consumed }]))).toThrow("paid_play_input");
    },
  );

  it.each([-1, 0.1, NaN, Infinity, 71, "1", null])(
    "rejects an invalid refund or refund exceeding consumption (%s)", (refunded) => {
      expect(() => evaluatePaidPlay(receipt([{ ...purchased(), refunded }]))).toThrow("paid_play_input");
    },
  );

  it("rejects duplicate allocation identities instead of counting twice", () => {
    expect(() => evaluatePaidPlay(receipt([purchased(), purchased()]))).toThrow("paid_play_input");
  });

  it("does not combine provider units even when their numbers match", () => {
    expect(() => evaluatePaidPlay(receipt([purchased(), { ...gift(), unit: "other-credit-v1" }])))
      .toThrow("paid_play_input");
  });

  it("rejects overflowing totals before precision is lost", () => {
    expect(() => evaluatePaidPlay(receipt([purchased(Number.MAX_SAFE_INTEGER), gift(1)])))
      .toThrow("paid_play_input");
  });

  it("accepts the safe integer boundary without floating point rounding", () => {
    expect(evaluatePaidPlay(receipt([purchased(Number.MAX_SAFE_INTEGER, 1)])))
      .toMatchObject({ qualifying: Number.MAX_SAFE_INTEGER - 1 });
  });

  it.each([
    null, [], {}, { ...receipt(), state: "purchased" }, { ...receipt(), state: ["settled"] },
    { ...receipt(), unit: "" }, { ...receipt(), allocations: {} },
    receipt([null]), receipt([{ ...purchased(), id: "" }]),
    receipt([{ ...purchased(), funding: null }]),
    receipt([{ ...purchased(), unit: undefined }]),
  ])("rejects malformed evidence without leaking receipt data", (input) => {
    expect(() => evaluatePaidPlay(input)).toThrow(/^paid_play_input$/);
  });

  it("validates pending evidence too, before it can later become settled", () => {
    expect(() => evaluatePaidPlay({ ...receipt([purchased(1, 2)]), state: "pending" }))
      .toThrow("paid_play_input");
  });

  it("bounds allocation count before processing a receipt", () => {
    expect(() => evaluatePaidPlay(receipt(Array.from({ length: 1001 }, (_, i) => ({ ...gift(), id: `lot-${i}` })))))
      .toThrow("paid_play_input");
  });
});
