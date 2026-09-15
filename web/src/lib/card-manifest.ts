/**
 * 卡片頁的 <head>：把站台的 manifest 換成這張卡的。
 *
 * 瀏覽器看到 <link rel="manifest"> 換了網址就重新評估「這一頁能不能安裝」，安裝下去的就是
 * 卡片自己的 manifest（id／start_url 都是那張卡的對話頁，見 Worker 的 src/shortcut.ts）。
 * iOS 沒有 manifest 的安裝事件，「加入主畫面」時讀的是 apple-touch-icon 與 apple-mobile-web-app-title，
 * 所以那兩個也一起換。離開卡片頁時全部換回站台的。
 *
 * 換過之後一定要告訴 lib/pwa.ts：它手上留著的安裝事件屬於前一份 manifest，按下去會裝錯東西。
 */
import { setInstallTarget } from "./pwa";

export interface CardHead {
  id: string;
  name: string;
  avatarUrl: string | null;
  nsfw?: boolean;
  /** 成人卡才有：伺服器發給過了門的人的短效鑰匙，manifest 與圖示網址都要帶。 */
  shortcutKey?: string;
}

export const SITE_HEAD = {
  manifest: "/manifest.webmanifest",
  touchIcon: "/icons/apple-touch-icon.png",
  title: "Hearthroom",
} as const;

export function cardHead(card: CardHead, locale: string): { manifest: string; touchIcon: string; title: string } {
  const id = encodeURIComponent(card.id);
  const key = card.shortcutKey ? `&k=${encodeURIComponent(card.shortcutKey)}` : "";
  return {
    manifest: `/v1/cards/${id}/manifest.webmanifest?lang=${encodeURIComponent(locale)}${key}`,
    // iOS 不吃 SVG 圖示：touch-icon.png 轉不了 PNG 時給原圖
    touchIcon: card.avatarUrl ? `/v1/cards/${id}/touch-icon.png${key ? "?" + key.slice(1) : ""}` : SITE_HEAD.touchIcon,
    title: card.name,
  };
}

function setLink(doc: Document, rel: string, href: string): void {
  let el = doc.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = doc.createElement("link"); el.rel = rel; doc.head.appendChild(el); }
  if (el.getAttribute("href") !== href) el.setAttribute("href", href);
}

function setMeta(doc: Document, name: string, content: string): void {
  let el = doc.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) { el = doc.createElement("meta"); el.name = name; doc.head.appendChild(el); }
  if (el.getAttribute("content") !== content) el.setAttribute("content", content);
}

/**
 * 進卡片頁帶卡片、離開帶 null。成人內容的卡只在有鑰匙時換（過了門的人才拿得到）：沒鑰匙那份
 * manifest 對瀏覽器（沒登入狀態）是 404，換了只會讓安裝入口消失又不知道為什麼。
 */
export function applyCardHead(card: CardHead | null, locale: string, doc: Document = document): void {
  const usable = card && (!card.nsfw || card.shortcutKey) ? card : null;
  const head = usable ? cardHead(usable, locale) : SITE_HEAD;
  setLink(doc, "manifest", head.manifest);
  setLink(doc, "apple-touch-icon", head.touchIcon);
  setMeta(doc, "apple-mobile-web-app-title", head.title);
  setInstallTarget(usable ? "card" : "site", usable?.name ?? "", usable?.avatarUrl ?? "");
}
