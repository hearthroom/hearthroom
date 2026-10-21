import { describe, expect, it } from "vitest";
import { gaPage, gaEvent, gaCampaign, appShell } from "../src/lib/ga4-payload";

describe("GA4 outbound privacy boundary", () => {
  it.each([
    ["/en/cards/123?ref=PRIVATE&s=SHARE123&q=secret#private", "/en/cards/_", "card"],
    ["/authors/private-handle", "/authors/_", "author"],
    ["/play/private-role?conversationId=private", "/play/_", "play"],
    ["/cards/private-role/edit", "/cards/_/edit", "editor"],
    ["/search?q=secret", "/search", "search"],
    ["/auth/callback?code=private&state=private", "/auth/callback", "login"],
    ["/me/notifications", "/me/notifications", "me"],
    ["/unknown/private-data", "/404", "404"],
  ])("masks %s", (path, clean, type) => {
    const page = gaPage(`https://sukisuki.ai${path}`, "https://sukisuki.chat/auth/callback?code=private");
    expect(page).toEqual({ page_location: `https://sukisuki.ai${clean}`, page_title: type, page_type: type,
      page_referrer: "https://sukisuki.chat/auth/callback" });
  });

  it("handles card-app hosts and strips external referrer paths and credentials", () => {
    expect(gaPage("https://play.sukisuki.ai/private-role/?ref=PRIVATE", "https://user:pass@example.com/private?q=secret"))
      .toEqual({ page_location: "https://play.sukisuki.ai/_/", page_title: "play", page_type: "play", page_referrer: "https://example.com/" });
    expect(gaPage("https://c123.sukisuki.ai/private")).toBeNull();
    expect(gaPage("https://console.harperharbor.com/me/billing")).toBeNull();
    expect(gaPage("invalid")).toBeNull();
    expect(gaPage("https://sukisuki.ai/review/members/private")).toBeNull();
  });

  it("maps only known successful events and never forwards subjects or arbitrary details", () => {
    expect(gaEvent("share", { detail: "share_clipboard", subject: "private-role" }, "card"))
      .toEqual({ name: "share", params: { method: "clipboard", content_type: "card" } });
    expect(gaEvent("share", { detail: "share_abort", ok: false }, "card")).toBeNull();
    expect(gaEvent("share", { detail: "share_private-handle" }, "card")).toBeNull();
    expect(gaEvent("error", { subject: "private" }, "card")).toBeNull();
    expect(gaEvent("plan_click", { detail: "wallet" }, "wallet"))
      .toEqual({ name: "begin_checkout", params: { item_category: "plan", entry: "wallet" } });
    expect(gaEvent("checkin_claim", { detail: "daily" }, "checkin"))
      .toEqual({ name: "checkin_claim", params: { kind: "daily" } });
  });

  it("recognizes referral categories without exporting codes and gives UTM precedence", () => {
    expect(gaCampaign("https://sukisuki.ai/cards/123?ref=PRIVATE"))
      .toEqual({ campaign_source: "card_share", campaign_medium: "referral" });
    expect(gaCampaign("https://sukisuki.ai/?s=PRIVATE"))
      .toEqual({ campaign_source: "campaign_share", campaign_medium: "referral" });
    expect(gaCampaign("https://sukisuki.ai/?ref=PRIVATE&utm_source=discord&utm_medium=community&utm_campaign=launch"))
      .toEqual({ campaign_source: "discord", campaign_medium: "community", campaign_name: "launch" });
    expect(gaCampaign("https://sukisuki.ai/?utm_source=private@example.com&utm_term=secret"))
      .toEqual({});
  });

  it("distinguishes the four supported app shells", () => {
    expect(appShell({ userAgent: "Android HearthroomApp/1.0" })).toBe("webview");
    expect(appShell({ referrer: "android-app://club.hearthroom.app" })).toBe("twa");
    expect(appShell({ twa: true })).toBe("twa");
    expect(appShell({ standalone: true })).toBe("pwa");
    expect(appShell({})).toBe("web");
  });
});
