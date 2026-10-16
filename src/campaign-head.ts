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

/**
 * 專屬連結（首頁＋?ref=）的分享預覽。看到預覽的人是還沒來過的朋友：他不在乎分享的人拿多少積分，
 * 要的是一眼看懂這是什麼網站、為什麼值得點（owner 2026-10-17）。所以標題講「朋友邀你、在這裡做什麼」，
 * 簡介講有哪些玩法、一點進來就能玩、用朋友的連結註冊有新人積分；圖用站台的分享圖（蘇綺招手）。
 * 新人積分的數字在 Harbor 的設定裡，這裡讀不到，所以不寫數字。
 */
const INVITE: Record<Locale, { title: string; description: string }> = {
  "zh-Hant": { title: "朋友邀你來綺夢社：和 AI 角色一起寫故事", description: "戀愛、冒險、世界模擬、玩法模擬，挑一張角色卡就能開聊，故事跟著你的選擇走。用朋友的連結註冊，還送新人積分先玩。" },
  "zh-Hans": { title: "朋友邀你来绮梦社：和 AI 角色一起写故事", description: "恋爱、冒险、世界模拟、玩法模拟，挑一张角色卡就能开聊，故事跟着你的选择走。用朋友的链接注册，还送新人积分先玩。" },
  en: { title: "A friend invited you to Hearthroom: write stories with AI characters", description: "Romance, adventure, world sims and game sims. Pick a character card and start chatting; the story follows your choices. Sign up through your friend's link for welcome credits." },
  ja: { title: "友だちから Hearthroom への招待：AI キャラクターと物語をつくろう", description: "恋愛、冒険、世界シミュレーター、ゲーム系まで。キャラクターカードを選べばすぐ会話でき、物語はあなたの選択で進みます。友だちのリンクから登録すると、はじめのポイントがもらえます。" },
  ko: { title: "친구가 Hearthroom에 초대했어요: AI 캐릭터와 함께 쓰는 이야기", description: "연애, 모험, 세계 시뮬레이터, 게임 시뮬레이터까지. 캐릭터 카드를 고르면 바로 대화할 수 있고 이야기는 당신의 선택을 따라가요. 친구 링크로 가입하면 시작 포인트를 받아요." },
};
const REF_CODE = /^[A-Z0-9]{4,32}$/i;
/** 首頁網址帶了像樣的推薦碼就是專屬連結 */
export const isInviteLink = (url: URL) => REF_CODE.test(url.searchParams.get("ref") ?? "");
export function inviteMeta(lang: Locale, url: string): PageMeta {
  return { lang, url, type: "website", ...INVITE[lang], image: siteOgImage("default", lang), imageSize: { width: 1200, height: 630 } };
}
