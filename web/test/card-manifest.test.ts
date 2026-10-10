import { beforeEach, describe, expect, it } from "vitest";
import { SITE_HEAD, applyCardHead, cardHead, siteHead } from "../src/lib/card-manifest";
import { installPrompt } from "../src/lib/pwa";

const q = (sel: string) => document.head.querySelector(sel)?.getAttribute(sel.startsWith("meta") ? "content" : "href");
const card = { id: "c-1", name: "夜行偵探", avatarUrl: "https://objects.example/a.jpg" };

beforeEach(() => {
  document.head.innerHTML = `<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-title" content="Hearthroom">`;
  applyCardHead(null, "zh-Hant");
});

describe("card manifest head swap", () => {
  it("points manifest, touch icon and title at the card, with the page locale", () => {
    expect(cardHead(card, "en")).toEqual({ manifest: "/v1/cards/c-1/manifest.webmanifest?lang=en", touchIcon: "/v1/cards/c-1/touch-icon.png", title: "夜行偵探" });
    expect(cardHead({ ...card, avatarUrl: null }, "en").touchIcon).toBe(SITE_HEAD.touchIcon);
  });

  it("swaps the head on enter and restores the site on leave; pwa target follows", () => {
    applyCardHead(card, "ja");
    expect(q('link[rel="manifest"]')).toBe("/v1/cards/c-1/manifest.webmanifest?lang=ja");
    expect(q('link[rel="apple-touch-icon"]')).toBe("/v1/cards/c-1/touch-icon.png");
    expect(q('meta[name="apple-mobile-web-app-title"]')).toBe("夜行偵探");
    expect(installPrompt.target).toBe("card");
    expect(installPrompt.name).toBe("夜行偵探");
    expect(installPrompt.icon).toBe(card.avatarUrl);

    applyCardHead(null, "ja");
    expect(q('link[rel="manifest"]')).toBe(SITE_HEAD.manifest);
    expect(q('link[rel="apple-touch-icon"]')).toBe(SITE_HEAD.touchIcon);
    expect(q('meta[name="apple-mobile-web-app-title"]')).toBe(SITE_HEAD.title);
    expect(installPrompt.target).toBe("site");
  });

  it("leaves the site head in place for adult cards without a key: their manifest is a 404 to the browser", () => {
    applyCardHead({ ...card, rating: "R" }, "zh-Hant");
    expect(q('link[rel="manifest"]')).toBe(siteHead("zh-Hant").manifest);
    expect(installPrompt.target).toBe("site");
  });

  it("the site head follows the locale: Chinese gets the Chinese name and manifest, other languages keep the defaults", () => {
    expect(siteHead("zh-Hant")).toEqual({ manifest: "/manifest.zh-Hant.webmanifest", touchIcon: SITE_HEAD.touchIcon, title: "綺夢社" });
    expect(siteHead("zh-Hans")).toEqual({ manifest: "/manifest.zh-Hans.webmanifest", touchIcon: SITE_HEAD.touchIcon, title: "绮梦社" });
    expect(siteHead("en")).toEqual(SITE_HEAD);
    expect(siteHead("ja")).toEqual(SITE_HEAD);

    applyCardHead(null, "zh-Hans");
    expect(q('link[rel="manifest"]')).toBe("/manifest.zh-Hans.webmanifest");
    expect(q('meta[name="apple-mobile-web-app-title"]')).toBe("绮梦社");
    applyCardHead(null, "en");
    expect(q('link[rel="manifest"]')).toBe(SITE_HEAD.manifest);
    expect(q('meta[name="apple-mobile-web-app-title"]')).toBe("Hearthroom");
  });

  it("adult card with a key: manifest and touch icon carry the key so the browser gets through", () => {
    applyCardHead({ ...card, rating: "R", shortcutKey: "123.ab+c" }, "en");
    expect(q('link[rel="manifest"]')).toBe("/v1/cards/c-1/manifest.webmanifest?lang=en&k=123.ab%2Bc");
    expect(q('link[rel="apple-touch-icon"]')).toBe("/v1/cards/c-1/touch-icon.png?k=123.ab%2Bc");
    expect(installPrompt.target).toBe("card");
  });

  it("creates the tags when the document lacks them", () => {
    document.head.innerHTML = "";
    applyCardHead(card, "ko");
    expect(q('link[rel="manifest"]')).toBe("/v1/cards/c-1/manifest.webmanifest?lang=ko");
    expect(q('meta[name="apple-mobile-web-app-title"]')).toBe("夜行偵探");
  });
});
