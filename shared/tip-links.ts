/**
 * 作者的打賞連結：作者在個人資料貼上自己在外部平台的打賞頁，卡片頁與作者頁出現入口。
 * 錢在那個平台付，本站不經手、不抽成（owner 2026-10-11 拍板，設計稿見 docs/author-tips.md）。
 *
 * 只認得這張表裡的網站，而且只認個人頁的形狀：任意網址會變成釣魚或導流的入口，
 * 短網址與中轉頁看不出最後去哪，一律不收。存的是由這裡重組出來的標準網址，不是作者貼的原文——
 * 讀出來時再過一次 parseTipLink，表改了（某個平台下架）舊資料自然不再顯示。
 *
 * 伺服器（驗證、公開輸出）與前端（即時提示、圖示）共用這一份。
 */

export type TipPlatformId = "patreon" | "fanbox" | "fantia" | "kofi" | "buymeacoffee" | "onlyfans" | "subscribestar";

export interface TipPlatform {
  id: TipPlatformId;
  /** 平台自己的寫法，不翻譯 */
  name: string;
  /** 條款禁止成人內容：從本站連過去可能讓作者的帳號被停用。可以綁，綁定時提醒作者 */
  caution?: true;
  /** 還沒有帳號的作者去哪裡開通 */
  signup: string;
  /** 個人頁網址的樣子，綁定時給作者對照 */
  example: string;
}

/**
 * 這張表的順序就是顯示順序：作者看到的支援平台清單、讀者看到的打賞面板都照它排。
 * 排法是中文與台灣讀者熟不熟（owner 2026-10-11）：pixiv 是 ACG 圈都知道的名字，OnlyFans 人人聽過，
 * Patreon 次之，Fantia 是同人圈在用的；Ko-fi、Buy Me a Coffee 知道的人少，條款也禁止成人內容；
 * SubscribeStar 最少人知道，成人規則 2026 年還在變動，放最後不主推。
 */
export const TIP_PLATFORMS: readonly TipPlatform[] = [
  { id: "fanbox", name: "pixiv FANBOX", signup: "https://www.fanbox.cc/", example: "https://www.fanbox.cc/@yourname" },
  { id: "onlyfans", name: "OnlyFans", signup: "https://onlyfans.com/", example: "https://onlyfans.com/yourname" },
  { id: "patreon", name: "Patreon", signup: "https://www.patreon.com/create", example: "https://www.patreon.com/yourname" },
  { id: "fantia", name: "Fantia", signup: "https://fantia.jp/", example: "https://fantia.jp/fanclubs/12345" },
  { id: "kofi", name: "Ko-fi", caution: true, signup: "https://ko-fi.com/", example: "https://ko-fi.com/yourname" },
  { id: "buymeacoffee", name: "Buy Me a Coffee", caution: true, signup: "https://buymeacoffee.com/", example: "https://buymeacoffee.com/yourname" },
  { id: "subscribestar", name: "SubscribeStar", signup: "https://subscribestar.adult/", example: "https://subscribestar.adult/yourname" },
];

/** 一位作者最多幾條：面板一眼看完，也不讓作者頁變成一排廣告 */
export const TIP_LINKS_MAX = 3;

export interface TipLink {
  platform: TipPlatformId;
  /** 作者在那個平台的名字或編號，面板上顯示 */
  handle: string;
  /** 標準網址，連出去用 */
  url: string;
}

export type TipParse =
  | { ok: true; link: TipLink }
  | { ok: false; reason: "invalid" | "shortener" | "unsupported" | "not_profile"; platform?: TipPlatformId };

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** 各平台網站本身的頁面（登入、搜尋⋯⋯）不是任何人的個人頁 */
const RESERVED = new Set(["login", "signin", "signup", "register", "home", "search", "explore", "settings", "about", "help", "terms", "privacy", "posts", "post", "join", "checkout", "my", "account", "discover", "creators", "user", "users", "api", "manage", "dashboard", "messages", "notifications"]);
const SHORTENERS = /^(?:bit\.ly|t\.co|tinyurl\.com|linktr\.ee|lnk\.bio|beacons\.ai|carrd\.co|reurl\.cc|ppt\.cc|is\.gd|goo\.gl|t\.cn|dwz\.cn|url\.cn|ow\.ly|buff\.ly|rebrand\.ly|cutt\.ly|s\.id|link\.tree)$/;

const isName = (s: string | undefined): s is string => !!s && NAME.test(s) && !RESERVED.has(s.toLowerCase());

/** host 去掉 www. 之後比對；回傳平台與重組好的連結 */
function recognize(host: string, segments: string[], query: URLSearchParams): TipParse {
  const [first, second] = segments;
  switch (host) {
    case "patreon.com": {
      // 沒設自訂網址的創作者，個人頁是 /user?u=<數字>
      const id = query.get("u");
      if (first === "user" && !second && id && /^\d{1,15}$/.test(id)) return hit("patreon", id, `https://www.patreon.com/user?u=${id}`);
      const name = first === "c" ? second : first;
      return isName(name) ? hit("patreon", name, `https://www.patreon.com/${name}`) : miss("patreon");
    }
    case "fanbox.cc":
      return first?.startsWith("@") && isName(first.slice(1)) ? hit("fanbox", first.slice(1), `https://www.fanbox.cc/@${first.slice(1)}`) : miss("fanbox");
    case "fantia.jp":
      return first === "fanclubs" && /^\d{1,12}$/.test(second ?? "") ? hit("fantia", second!, `https://fantia.jp/fanclubs/${second}`) : miss("fantia");
    case "ko-fi.com":
      return isName(first) ? hit("kofi", first, `https://ko-fi.com/${first}`) : miss("kofi");
    case "buymeacoffee.com":
      return isName(first) ? hit("buymeacoffee", first, `https://buymeacoffee.com/${first}`) : miss("buymeacoffee");
    case "onlyfans.com":
      return first && /^[A-Za-z0-9_.-]{1,64}$/.test(first) && !RESERVED.has(first.toLowerCase()) ? hit("onlyfans", first, `https://onlyfans.com/${first}`) : miss("onlyfans");
    case "subscribestar.com": case "subscribestar.adult":
      return isName(first) ? hit("subscribestar", first, `https://${host === "subscribestar.adult" ? "subscribestar.adult" : "www.subscribestar.com"}/${first}`) : miss("subscribestar");
  }
  // FANBOX 的個人頁也可以是子網域：<name>.fanbox.cc
  const sub = host.match(/^([a-z0-9][a-z0-9_-]{0,63})\.fanbox\.cc$/);
  if (sub && !RESERVED.has(sub[1])) return hit("fanbox", sub[1], `https://www.fanbox.cc/@${sub[1]}`);
  return { ok: false, reason: "unsupported" };
}
const hit = (platform: TipPlatformId, handle: string, url: string): TipParse => ({ ok: true, link: { platform, handle, url } });
const miss = (platform: TipPlatformId): TipParse => ({ ok: false, reason: "not_profile", platform });

/** 作者貼的一條網址 → 平台與標準網址。沒寫 https:// 也認；http 一律升成 https。 */
export function parseTipLink(raw: string): TipParse {
  const text = raw.trim();
  if (!text || text.length > 300 || /\s/.test(text)) return { ok: false, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port) return { ok: false, reason: "invalid" };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (SHORTENERS.test(host)) return { ok: false, reason: "shortener" };
  const segments = url.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return recognize(host, segments, url.searchParams);
}

export const tipPlatform = (id: TipPlatformId) => TIP_PLATFORMS.find((p) => p.id === id)!;

/** 只給帳號名時，照平台組出個人頁網址 */
const PROFILE: Record<TipPlatformId, (handle: string) => string> = {
  fanbox: (h) => `https://www.fanbox.cc/@${h}`,
  onlyfans: (h) => `https://onlyfans.com/${h}`,
  patreon: (h) => (/^\d+$/.test(h) ? `https://www.patreon.com/user?u=${h}` : `https://www.patreon.com/${h}`),
  fantia: (h) => `https://fantia.jp/fanclubs/${h}`,
  kofi: (h) => `https://ko-fi.com/${h}`,
  buymeacoffee: (h) => `https://buymeacoffee.com/${h}`,
  subscribestar: (h) => `https://subscribestar.adult/${h}`,
};

/**
 * 綁定表單的一格：作者先選了平台，再貼網址或只打帳號名。
 * 看起來像網址（有斜線，或以網域開頭）就照網址認，認出來是別的平台也照收；否則當成這個平台的帳號名。
 */
export function resolveTipInput(platform: TipPlatformId, raw: string): TipParse {
  const text = raw.trim();
  if (/\//.test(text) || /^(?:https?:|www\.)/i.test(text) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|cc|jp|adult|net|ee|ly|co|gd|cn|io|me|ai|to|id)$/i.test(text)) return parseTipLink(text);
  const handle = text.replace(/^@/, "");
  if (!handle) return { ok: false, reason: "invalid" };
  return parseTipLink(PROFILE[platform](handle));
}

/**
 * 存起來的標準網址（JSON 陣列）→ 公開輸出。壞掉的 JSON、不再支援的網址都略過。
 * 照 orderTipLinks 排好再出去。
 */
export function readTipLinks(stored: string | null | undefined): TipLink[] {
  let list: unknown;
  try { list = JSON.parse(stored || "[]"); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out: TipLink[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const parsed = parseTipLink(item);
    if (parsed.ok && !out.some((l) => l.url === parsed.link.url)) out.push(parsed.link);
  }
  return orderTipLinks(out.slice(0, TIP_LINKS_MAX));
}

/**
 * 讀者看到的順序：照 TIP_PLATFORMS 的熟悉度排，不照作者填的順序——讀者先看到自己認得的平台，
 * 比較可能真的點下去（owner 2026-10-11）。
 *
 * 沒有中國大陸的付款方式是刻意的：愛發電要實名、走國內金流，作者把它掛在成人卡旁邊等於把真實身分
 * 和「靠淫穢物品牟利」的證據放在一起，提醒擋不住忘記的人，所以不收（owner 2026-10-11）。
 */
export function orderTipLinks<T extends { platform: TipPlatformId }>(links: readonly T[]): T[] {
  const rank = (l: T) => TIP_PLATFORMS.findIndex((p) => p.id === l.platform);
  return [...links].sort((a, b) => rank(a) - rank(b));
}
