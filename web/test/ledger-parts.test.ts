import { expect, it } from "vitest";
import { ledgerParts } from "../src/lib/ledger-parts";

const p = (source: string, amount: number) => ({ source, amount });

it("two or more kinds of source make a row expandable; the parts add up to the row", () => {
  const rows = ledgerParts([p("checkin", 131), p("purchase", 212), p("plan_daily", 150)], 493);
  expect(rows?.map((r) => r.key)).toEqual(["wallet.source.purchase", "wallet.reason.planDaily", "wallet.reason.checkin"]);
  expect(rows?.reduce((n, r) => n + r.amount, 0)).toBe(493);
});

it("many parts of one kind stay a plain row", () => {
  expect(ledgerParts([p("purchase", 100)], 100)).toBeNull();
  expect(ledgerParts([p("purchase", 60), p("purchase", 40)], 100)).toBeNull();
});

it("unknown codes show as other sources, never the raw code, and merge with each other", () => {
  const rows = ledgerParts([p("test", 5), p("refund", 5), p("purchase", 10)], 20);
  expect(rows).toEqual([{ key: "wallet.source.purchase", amount: 10 }, { key: "wallet.source.other", amount: 10 }]);
});

it("drops zero amounts, and ties follow the fixed order", () => {
  expect(ledgerParts([p("grant", 0), p("purchase", 10)], 10)).toBeNull();
  expect(ledgerParts([p("redeem", 10), p("checkin", 10)], 20)?.map((r) => r.key)).toEqual(["wallet.reason.checkin", "wallet.reason.redeem"]);
});

it("falls back to a plain row when the parts don't add up or are missing", () => {
  expect(ledgerParts([p("purchase", 10), p("checkin", 10)], 25)).toBeNull();
  expect(ledgerParts(undefined, 25)).toBeNull();
  expect(ledgerParts([], 25)).toBeNull();
});
