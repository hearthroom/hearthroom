import { PRIMARY_HOST } from "../shared/site-hosts";
import { siteName } from "../shared/site-name";
import { plainText } from "./blog-head";
import type { Campaign } from "./campaign";
import { oneLine, siteOgImage, type PageMeta } from "./head";

/**
 * 活動頁 /campaign/:slug 的 <head>：給不跑 JS 的分享抓取器（LINE、Discord、QQ、微信、X）看的標題、簡介與圖片。
 * 活動是拉新用的，連結會被貼到 QQ 群、貼吧、巴哈、Dcard，預覽長什麼樣就是第一印象。
 *
 * 語言（owner 2026-10-17：能分繁簡最好，分不出來就簡體）：
 * - 網址有語言前綴（/zh-Hans、/en…）就照前綴。站內複製的專屬連結會帶分享者的介面語言前綴（繁中沒有前綴）。
 * - 沒有前綴時看抓取器送的 Accept-Language：台港澳或標了 Hant 的是繁中，其餘一律簡中——
 *   包括沒送、送英文的抓取器，以及只寫 zh 的。回應帶 Vary: Accept-Language。
 */
const origin = `https://${PRIMARY_HOST}`;
const LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
type Locale = (typeof LOCALES)[number];

const HANT = /^zh-(?:hant|tw|hk|mo)\b/i;
/** 沒有語言前綴的活動頁該用哪一種中文 */
export function campaignLocale(prefix: string | undefined, acceptLanguage: string | undefined): Locale {
  if (prefix && (LOCALES as readonly string[]).includes(prefix)) return prefix as Locale;
  const first = (acceptLanguage ?? "").split(",").map((p) => p.split(";")[0]!.trim()).find((tag) => /^zh\b/i.test(tag));
  return first && HANT.test(first) ? "zh-Hant" : "zh-Hans";
}

export const campaignUrl = (locale: string | undefined, slug: string) =>
  `${origin}${locale ? `/${locale}` : ""}/campaign/${encodeURIComponent(slug)}`;

/** 這個語言沒填就退回繁中（後台繁中必填），再退回任何一個有字的語言 */
const pick = (text: Partial<Record<string, string>>, lang: Locale) => text[lang] || text["zh-Hant"] || Object.values(text).find(Boolean) || "";

/** 介紹沒寫時的一句話。分享的可以是網站本身，不一定是卡（owner 2026-10-17：剛開站卡還不多）*/
const FALLBACK: Record<Locale, string> = {
  "zh-Hant": "向朋友介紹綺夢社或分享喜歡的卡就能拿積分，朋友用你的連結註冊還有推薦分成。",
  "zh-Hans": "向朋友介绍绮梦社或分享喜欢的卡就能拿积分，朋友用你的链接注册还有推荐分成。",
  en: "Tell friends about Hearthroom or share a card you love to earn credits, and get a cut when they join through your link.",
  ja: "Hearthroom の紹介やお気に入りカードのシェアでポイントがもらえ、リンクから登録した友だちのチャージでも特典があります。",
  ko: "Hearthroom을 소개하거나 좋아하는 카드를 공유하면 포인트를 받고, 내 링크로 가입한 친구가 충전하면 보상도 나눠 받아요.",
};

/** 公開活動的分享資訊；草稿或不存在由呼叫端擋（回 404＋noindex）。 */
export function campaignMeta(c: Campaign, lang: Locale, url: string): PageMeta {
  const title = pick(c.title, lang) || c.slug;
  const description = oneLine(plainText(pick(c.intro, lang)), 160) || FALLBACK[lang];
  const banner = c.bannerUrl ? `${origin}${c.bannerUrl}` : null;
  return {
    lang, url, type: "website",
    title: `${title} · ${siteName(lang)}`,
    description,
    // 橫幅是 16:6，預覽會從中間裁；沒有橫幅用站台的 1200×630 預設圖
    image: banner ?? siteOgImage("default", lang),
    ...(banner ? {} : { imageSize: { width: 1200, height: 630 } }),
  };
}
