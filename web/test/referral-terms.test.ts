import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { calcExample, fetchReferralTerms, friendTotal, referralShown, resetReferralTermsCache, type ReferralTerms } from "../src/lib/referral-terms";

const terms = (extra: Partial<ReferralTerms> = {}): ReferralTerms => ({
  enabled: true, firstPercent: 20, firstCap: 24000, inviteePercent: 0, rebatePercent: 5, rebateDays: 365, bindDays: 7,
  welcomeCredits: 1000, welcomeDays: 30, signupWelcomeCredits: 1000, signupWelcomeDays: 30, ...extra,
});

beforeEach(() => resetReferralTermsCache());
afterEach(() => vi.unstubAllGlobals());

it("reads the public terms without a token and remembers them", async () => {
  const f = vi.fn(async () => new Response(JSON.stringify(terms()), { status: 200 }));
  vi.stubGlobal("fetch", f);
  expect(await fetchReferralTerms()).toEqual(terms());
  await fetchReferralTerms();
  expect(f).toHaveBeenCalledTimes(1);
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit | undefined];
  expect(url).toMatch(/\/open\/v1\/referral\/terms$/);
  expect(init?.headers).toBeUndefined();
});

it("returns null when the terms cannot be read, and asks again next time", async () => {
  const f = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", f);
  expect(await fetchReferralTerms()).toBeNull();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
  expect(await fetchReferralTerms()).toBeNull();
});

it("hides referral numbers when referral is off or pays nothing", () => {
  expect(referralShown(null)).toBe(false);
  expect(referralShown(terms({ enabled: false }))).toBe(false);
  expect(referralShown(terms({ firstPercent: 0, rebatePercent: 0 }))).toBe(false);
  expect(referralShown(terms({ firstPercent: 0 }))).toBe(true);
});

it("adds the sign-up and referral gifts for the friend's total", () => {
  expect(friendTotal(terms())).toBe(2000);
  expect(friendTotal(terms({ signupWelcomeCredits: 0 }))).toBe(1000);
});

it("works the example from the campaign and referral settings, capping the first top-up share", () => {
  expect(calcExample(3000, 500, terms())).toEqual({ base: 3000, extra: 1000, share: 4000, first: 6000, rebate: 500, total: 10500 });
  expect(calcExample(3000, 500, terms({ firstCap: 5000 })).first).toBe(5000);
  expect(calcExample(3000, 500, null)).toEqual({ base: 3000, extra: 1000, share: 4000, first: null, rebate: null, total: 4000 });
  expect(calcExample(3000, 0, terms({ enabled: false })).total).toBe(3000);
});
