import { PRIMARY_HOST } from "../shared/site-hosts";
import { SITE_NAME, siteLockup, siteName } from "../shared/site-name";
/**
 * 分享預覽：把下載頁／卡片／作者的標題、簡介、圖片寫進 HTML 的 <head>。
 *
 * 這是個 SPA，Discord、LINE、X 的抓取器不跑 JS——它們看到的是 index.html 裡那幾行
 * 寫死的 meta，於是每一張卡分享出去長得一模一樣。這裡在邊緣把那幾行換掉；其餘的
 * HTML 原封不動，前端接手之後照常渲染。
 *
 * 只處理 <head> 裡已經存在的標籤與 <html lang>；沒有 SSR、不碰 <body>。
 */

export interface PageMeta {
  /** BCP 47，寫進 <html lang> 與 og:locale */
  lang: string;
  title: string;
  description: string;
  /** 分享預覽圖（og:image／twitter:image）。 */
  image?: string | null;
  /** 分享預覽圖的尺寸：確定時才給（作者照 1200×630 畫的分享圖），抓取器不必先下載就能排版。 */
  imageSize?: { width: number; height: number };
  url: string;
  type: "profile" | "website" | "article";
  /** 文章型頁面：發布與修改時間（ISO 8601），另附 JSON-LD。 */
  article?: { published: string; modified: string; jsonLd: unknown };
  /**
   * 頁面主圖的網址，一進 HTML 就開始下載。卡片頁最大的那張是直式封面，
   * 不先講的話要等 JS 跑完、卡片資料回來才知道網址（實測 LCP 的載入延遲約 0.5 s）。
   * 跟分享預覽圖分開：預覽圖是給抓取器的 1.91:1，不是頁面上畫的那張。
   */
  preloadImage?: string | null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** JSON-LD 放進 <script>：< 與兩個 JS 換行字元跳脫，標題寫了 </script> 也關不掉這一段。 */
export const jsonLdText = (v: unknown) =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** 簡介壓成一行、截到抓取器會顯示的長度；多的只是浪費位元組 */
export const oneLine = (s: string, max = 200) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** 作者頁的一句簡介。Worker 端沒有翻譯檔，這幾個字就地寫；數字用該語言的千分位 */
const AUTHOR_LINE: Record<string, (cards: string, talks: string) => string> = {
  "zh-Hant": (c, t) => `${c} 張作品 · ${t} 次對話`,
  "zh-Hans": (c, t) => `${c} 张作品 · ${t} 次对话`,
  en: (c, t) => `${c} cards · ${t} chats`,
  ja: (c, t) => `作品 ${c} · 会話 ${t}`,
  ko: (c, t) => `작품 ${c} · 대화 ${t}`,
};
export function authorLine(lang: string, cards: number, talks: number): string {
  const fmt = new Intl.NumberFormat(lang);
  return (AUTHOR_LINE[lang] ?? AUTHOR_LINE.en!)(fmt.format(cards), fmt.format(talks));
}

const OG_LOCALE: Record<string, string> = { "zh-Hant": "zh_TW", "zh-Hans": "zh_CN", en: "en_US", ja: "ja_JP", ko: "ko_KR" };
const SITE_OG_LANGS = new Set(["zh-Hant", "zh-Hans", "en", "ja", "ko"]);
export type SiteOgKind = "default" | "download" | "updates";

/**
 * 換了圖就把版本加一：Discord、LINE、微信照網址快取預覽圖，檔名不變的話會一直顯示舊圖。
 * default v2（2026-10-17）：圖上那句從「角色卡的開放社群：榜單、搜尋與作者頁」換成「挑一張角色卡，今晚的故事由你決定」。
 */
const OG_VERSION: Partial<Record<SiteOgKind, number>> = { default: 2 };
/** 站台自己的分享圖；不認得的語言一律用英文版。 */
export function siteOgImage(kind: SiteOgKind, lang: string): string {
  const locale = SITE_OG_LANGS.has(lang) ? lang : "en";
  const v = OG_VERSION[kind];
  return `https://${PRIMARY_HOST}/og/${kind}-${locale}.jpg${v ? `?v=${v}` : ""}`;
}

/** 頁面主圖一進 HTML 就開始下載（見 PageMeta.preloadImage）。 */
export function preloadImageTag(url: string, priority: "high" | "auto" = "high"): string {
  return `<link rel="preload" as="image" href="${esc(url)}"${priority === "high" ? ' fetchpriority="high"' : ""}>`;
}

/** 殼（web/index.html）自己帶了一份預設分享標籤給沒經過 Worker 的頁面；這裡要寫自己的，先拿掉殼的，免得同一個標籤出現兩次 */
const stripShareTags = (r: HTMLRewriter) => r
  .on('meta[property^="og:"]', { element: (e) => { e.remove(); } })
  .on('meta[name^="twitter:"]', { element: (e) => { e.remove(); } });

export function renderHead(page: Response, meta: PageMeta): Response {
  const description = oneLine(meta.description);
  const tags = [
    `<link rel="canonical" href="${esc(meta.url)}">`,
    `<meta property="og:type" content="${meta.type}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(meta.url)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[meta.lang] ?? "en_US"}">`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}">` : "",
    meta.image && meta.imageSize ? `<meta property="og:image:width" content="${meta.imageSize.width}"><meta property="og:image:height" content="${meta.imageSize.height}">` : "",
    meta.preloadImage ? preloadImageTag(meta.preloadImage) : "",
    meta.article ? `<meta property="article:published_time" content="${esc(meta.article.published)}"><meta property="article:modified_time" content="${esc(meta.article.modified)}">` : "",
    meta.article ? `<script type="application/ld+json">${jsonLdText(meta.article.jsonLd)}</script>` : "",
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    meta.image ? `<meta name="twitter:image" content="${esc(meta.image)}">` : "",
  ].filter(Boolean).join("");

  const res = stripShareTags(new HTMLRewriter())
    .on("html", { element: (e) => { e.setAttribute("lang", meta.lang); } })
    .on("title", { element: (e) => { e.setInnerContent(meta.title); } })
    .on('meta[name="description"]', { element: (e) => { e.setAttribute("content", description); } })
    .on("head", { element: (e) => { e.append(tags, { html: true }); } })
    .transform(page);
  // 殼的 ETag／Last-Modified 代表的是 index.html，不是改寫後這一份；留著會讓下游用錯的驗證器重驗
  res.headers.delete("etag");
  res.headers.delete("last-modified");
  return res;
}

/**
 * SPA 一般頁面只補分享標籤：不改分頁標題、description 或 canonical。
 * 那些頁面由前端接手後自己設標題，這裡只服務不跑 JS 的分享抓取器。
 */
export function renderDefaultShareHead(page: Response, lang: string): Response {
  const meta = defaultMeta(lang);
  // 微信、QQ 不看 og:，讀的是 <title> 與 description：殼裡的也換成站名與說明，前端跑起來會再寫自己的標題
  const tags = [
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(oneLine(meta.description))}">`,
    `<meta property="og:image" content="${esc(meta.image)}">`,
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
    `<meta property="og:locale" content="${OG_LOCALE[lang] ?? "en_US"}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(oneLine(meta.description))}">`,
    `<meta name="twitter:image" content="${esc(meta.image)}">`,
  ].join("");
  const res = stripShareTags(new HTMLRewriter())
    .on("html", { element: (e) => { e.setAttribute("lang", lang); } })
    .on("title", { element: (e) => { e.setInnerContent(meta.title); } })
    .on('meta[name="description"]', { element: (e) => { e.setAttribute("content", oneLine(meta.description)); } })
    .on("head", { element: (e) => { e.append(tags, { html: true }); } }).transform(page);
  res.headers.delete("etag");
  res.headers.delete("last-modified");
  return res;
}

/** Public download copy belongs in the initial HTML, before any client JS runs. */
const DOWNLOAD_COPY: Record<string, {title:string;description:string}> = {
  "zh-Hant": {title:"下載綺夢社",description:"綺夢社的 Android App 與瀏覽器安裝指南：下載最新版 APK，查看手機安裝步驟與 App 更新方式。"},
  "zh-Hans": {title:"下载绮梦社",description:"绮梦社的 Android App 与浏览器安装指南：下载最新版 APK，查看手机安装步骤与 App 更新方式。"},
  en: {title:`Download ${SITE_NAME}`,description:`Get the latest ${SITE_NAME} Android APK, follow the installation guide, and learn how app updates work. Browser installation options are included.`},
  ja: {title:`${SITE_NAME} をダウンロード`,description:`${SITE_NAME} の最新 Android APK とインストールガイド。スマートフォンへの導入、アプリの更新、ブラウザからの利用方法を確認できます。`},
  ko: {title:`${SITE_NAME} 다운로드`,description:`${SITE_NAME} 최신 Android APK와 설치 가이드입니다. 휴대폰 설치 단계, 앱 업데이트 및 브라우저 설치 방법을 확인하세요.`},
};
export function downloadMeta(lang:string,url:string):PageMeta {
  return {lang,...(DOWNLOAD_COPY[lang] ?? DOWNLOAD_COPY.en!),url,type:"website",image:siteOgImage("download", lang),imageSize:{width:1200,height:630}};
}

/** 更新頁的分享預覽：說明這一頁是什麼，不列內容（內容每天在變）。 */
const UPDATES_COPY: Record<string, {title:string;description:string}> = {
  "zh-Hant": {title:"綺夢社更新紀錄",description:"綺夢社每次上線了什麼新功能、修好了哪些問題，都記在這裡，每一項都附上去哪裡試。"},
  "zh-Hans": {title:"绮梦社更新记录",description:"绮梦社每次上线了什么新功能、修好了哪些问题，都记在这里，每一项都附上去哪里试。"},
  en: {title:`${SITE_NAME} updates`,description:`Every new feature and fix that went live on ${SITE_NAME}, with a link to try each one.`},
  ja: {title:`${SITE_NAME} の更新履歴`,description:`${SITE_NAME} に追加された新機能と修正の一覧です。それぞれ試せる場所へのリンクも載せています。`},
  ko: {title:`${SITE_NAME} 업데이트 기록`,description:`${SITE_NAME}에 새로 추가된 기능과 수정 사항을 모았습니다. 항목마다 바로 써 볼 수 있는 링크가 있습니다.`},
};
export function updatesMeta(lang:string,url:string):PageMeta {
  return {lang,...(UPDATES_COPY[lang] ?? UPDATES_COPY.en!),url,type:"website",image:siteOgImage("updates", lang),imageSize:{width:1200,height:630}};
}

/**
 * 首頁的 <head>：不跑 JS 的爬蟲與連結預覽只看得到這份，前端 pageTitle() 跑起來之後會再寫一次同樣的字。
 * 中文的標題是品牌全名（shared/site-name.ts）；其他語言是站名接標語，跟前端 locales 的 site.tagline 同字。
 */
const HOME_TAGLINE: Record<string, string> = {
  en: "Character Board",
  ja: "キャラクターカード ランキング",
  ko: "캐릭터 카드 랭킹",
};
/**
 * 分享預覽的說明（首頁與沒有自己分享設定的頁面）。看的人多半沒來過：要一眼看懂這是什麼網站、為什麼值得點，
 * 不是列功能（owner 2026-10-17）。約戰團隊會再改寫一版（docs/design/share-season-campaign）。
 */
export const HOME_DESCRIPTION: Record<string, string> = {
  "zh-Hant": "和 AI 角色一起寫故事：戀愛、冒險、世界模擬、玩法模擬，挑一張角色卡就能開聊，故事跟著你的選擇走。",
  "zh-Hans": "和 AI 角色一起写故事：恋爱、冒险、世界模拟、玩法模拟，挑一张角色卡就能开聊，故事跟着你的选择走。",
  en: "Write stories with AI characters: romance, adventure, world sims and game sims. Pick a character card and start chatting; the story follows your choices.",
  ja: "AI キャラクターと物語をつくろう：恋愛、冒険、世界シミュレーター、ゲーム系まで。キャラクターカードを選べばすぐ会話でき、物語はあなたの選択で進みます。",
  ko: "AI 캐릭터와 함께 쓰는 이야기: 연애, 모험, 세계 시뮬레이터, 게임 시뮬레이터까지. 캐릭터 카드를 고르면 바로 대화할 수 있고 이야기는 당신의 선택을 따라가요.",
};
export function defaultMeta(lang: string): { title: string; description: string; image: string } {
  const title = siteLockup(lang) ?? `${siteName(lang)} · ${HOME_TAGLINE[lang] ?? HOME_TAGLINE.en!}`;
  return { title, description: HOME_DESCRIPTION[lang] ?? HOME_DESCRIPTION.en!, image: siteOgImage("default", lang) };
}
export function homeMeta(lang:string,url:string):PageMeta {
  return {lang,...defaultMeta(lang),url,type:"website",imageSize:{width:1200,height:630}};
}
