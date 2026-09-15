import { describe, expect, it } from "vitest";
import { dismissWaitMs, isIosSafari, readDismissCount, readDismissedAt, recordVisit, shouldOffer } from "../src/lib/pwa";

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

  it("offers from the first visit, never in standalone, and respects a recent dismissal", () => {
    const now = Date.UTC(2026, 8, 15);
    expect(shouldOffer({ standalone: false, dismissedAt: null, visitDays: 0, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: null, visitDays: 1, now })).toBe(true);
    expect(shouldOffer({ standalone: false, dismissedAt: null, visitDays: 2, now })).toBe(true);
    expect(shouldOffer({ standalone: true, dismissedAt: null, visitDays: 5, now })).toBe(false);
    // 第一次按「以後再說」只歇一天
    expect(shouldOffer({ standalone: false, dismissedAt: now - 0.5 * DAY, dismissCount: 1, visitDays: 5, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: now - 1.1 * DAY, dismissCount: 1, visitDays: 5, now })).toBe(true);
    // 按得越多歇越久：第三次七天，第五次以後三十天
    expect(shouldOffer({ standalone: false, dismissedAt: now - 5 * DAY, dismissCount: 3, visitDays: 5, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: now - 8 * DAY, dismissCount: 3, visitDays: 5, now })).toBe(true);
    expect(shouldOffer({ standalone: false, dismissedAt: now - 20 * DAY, dismissCount: 9, visitDays: 5, now })).toBe(false);
    expect(shouldOffer({ standalone: false, dismissedAt: now - 31 * DAY, dismissCount: 9, visitDays: 5, now })).toBe(true);
    // 沒記到次數（舊資料）當第一次
    expect(shouldOffer({ standalone: false, dismissedAt: now - 2 * DAY, visitDays: 5, now })).toBe(true);
  });

  it("backs off 1, 3, 7, 14, 30 days and then stays at 30", () => {
    expect([1, 2, 3, 4, 5, 6, 0].map((n) => dismissWaitMs(n) / DAY)).toEqual([1, 3, 7, 14, 30, 30, 1]);
  });

  it("reads the dismiss count defensively", () => {
    const s = new Mem();
    expect(readDismissCount(s)).toBe(0);
    s.setItem("hearthroom.pwa.dismissCount", "2.7");
    expect(readDismissCount(s)).toBe(2);
    s.setItem("hearthroom.pwa.dismissCount", "x");
    expect(readDismissCount(s)).toBe(0);
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

describe("install target", () => {
  it("switching target hides a pending toast and drops availability until the browser re-offers", async () => {
    const { installPrompt, setInstallTarget } = await import("../src/lib/pwa");
    installPrompt.visible = true;
    setInstallTarget("card", "夜行偵探");
    expect(installPrompt.visible).toBe(false);
    expect(installPrompt.target).toBe("card");
    expect(installPrompt.available).toBe(false);
    setInstallTarget("site");
    expect(installPrompt.target).toBe("site");
    expect(installPrompt.name).toBe("");
  });
});

describe("android chrome with the site already installed", () => {
  it("recognises Android Chrome and not other Android browsers", async () => {
    const { isAndroidChromium } = await import("../src/lib/pwa");
    expect(isAndroidChromium("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36")).toBe(true);
    expect(isAndroidChromium("Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0")).toBe(false);
    expect(isAndroidChromium("Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36")).toBe(false);
    expect(isAndroidChromium("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36")).toBe(false);
  });
});
