/**
 * 站名在各語言介面上的寫法。
 *
 * 中文市場用中文名「綺夢社」，副標「寢物語」；其他語言一律叫 SukiSuki（owner 2026-10-17，原本是 Hearthroom）。
 * 這裡是客戶端與 Worker 共用的唯一出處：分頁標題、頁首品牌、主畫面名字、分享預覽、Atom feed、
 * Discord 摘要都從這裡取名字，不進翻譯檔——品牌名是專有名詞，不是翻譯者的工作（2026-10-06 owner 定案）。
 * 翻譯檔裡要提站名的句子寫 {site}，載入語言檔時代入（web/src/lib/i18n.ts）。
 *
 * 協定識別不在這裡，那些不隨語言變：UA 的 HearthroomApp、X-Hearthroom-Request、OAuth 的 client_name、
 * CLI 的名字、Android App 的標籤，以及開發者面（GitHub repo、API 名、llms.txt）——這些還叫 Hearthroom。
 */
export const SITE_NAME = "SukiSuki";

// 副標帶 AI：這個品類的人搜的是「AI 角色扮演」，兩個直接競品都把 AI 寫在名字裡；味道留在主名，品類交給副標（2026-10-07 owner）。
const CHINESE: Record<string, { name: string; subtitle: string }> = {
  "zh-Hant": { name: "綺夢社", subtitle: "AI寢物語" },
  "zh-Hans": { name: "绮梦社", subtitle: "AI寝物语" },
};

/** 這個語言的介面上，站台叫什麼。 */
export function siteName(locale: string): string {
  return CHINESE[locale]?.name ?? SITE_NAME;
}

/** 中文名的副標。只跟主名連寫在首頁的分頁標題裡；頁首品牌只顯示主名。其他語言沒有副標。 */
export function siteSubtitle(locale: string): string | null {
  return CHINESE[locale]?.subtitle ?? null;
}

/** 首頁分頁標題的品牌全名：中文「綺夢社・AI寢物語」；其他語言回 null，呼叫端接標語。 */
export function siteLockup(locale: string): string | null {
  const subtitle = siteSubtitle(locale);
  return subtitle ? `${siteName(locale)}・${subtitle}` : null;
}
