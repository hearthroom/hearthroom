import { describe, expect, it } from "vitest";
import { isIosSafari, readDismissedAt, recordVisit, shouldOffer } from "../src/lib/pwa";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

const DAY = 24 * 60 * 60 * 1000;

describe("pwa install prompt", () => {
  it("counts distinct visit days, not visits", () => {
    const s = new Mem();
    const t0 = Date.UTC(2026, 8, 15, 10);
    expect(recordVisit(s, t0)).toBe(1);
    expect(recordVisit(s, t0 + 3600_000)).toBe(1);
    expect(recordVisit(s, t0 + DAY)).toBe(2);
    expect(recordVisit(s, t0 + 3 * DAY)).toBe(3);
  });

  it("keeps only the most recent days and survives garbage", () => {
    const s = new Mem();
    s.setItem("hearthroom.pwa.days", "not json");
    expect(recordVisit(s, Date.UTC(2026, 8, 1))).toBe(1);
    for (let i = 1; i < 20; i++) recordVisit(s, Date.UTC(2026, 8, 1) + i * DAY);
    expect(JSON.parse(s.getItem("hearthroom.pwa.days")!).length).toBe(8);
  });

  it("treats no storage as a first visit", () => { expect(recordVisit(null)).toBe(1); });

  it("offers only on a return visit, never in standalone, and respects a recent dismissal", () => {
    const now = Date.UTC(2026, 8, 15);
    expect(shouldOffer({ standalone: false, dismissedAt: null, visitDays: 1, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: null, visitDays: 2, now })).toBe(true);
    expect(shouldOffer({ standalone: true, dismissedAt: null, visitDays: 5, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: now - 10 * DAY, visitDays: 5, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: now - 31 * DAY, visitDays: 5, now })).toBe(true);
  });

  it("reads a dismissal timestamp defensively", () => {
    const s = new Mem();
    expect(readDismissedAt(s)).toBeNull();
    s.setItem("hearthroom.pwa.dismissedAt", "abc");
    expect(readDismissedAt(s)).toBeNull();
    s.setItem("hearthroom.pwa.dismissedAt", "1700000000000");
    expect(readDismissedAt(s)).toBe(1700000000000);
    expect(readDismissedAt(null)).toBeNull();
  });

  it("detects iOS Safari but not other iOS browsers or desktops", () => {
    const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const chromeIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0 Mobile/15E148 Safari/604.1";
    const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Mobile Safari/537.36";
    expect(isIosSafari(safari)).toBe(true);
    expect(isIosSafari(chromeIos)).toBe(false);
    expect(isIosSafari(android)).toBe(false);
  });
});
