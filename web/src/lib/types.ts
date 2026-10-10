import type { Rating, Topic } from "../../../shared/content-rating";
export interface Localized { zh: string; en: string; ja: string; ko: string }

/** 語區。榜單按這個分開列；all 是不分語言的卡，每區都出現。 */
export type Zone = "zh" | "en" | "ja" | "ko";

export interface CommunityCard {
  id: string;
  roleId: string;
  sourceRoleId?: string;
  zone: Zone | "all";
  /** 支援哪家供應商（供應商代號）：拿那家的帳號在本站玩。 */
  provider?: string;
  /** 台灣遊戲分級五級之一；R＝成人內容；null＝評級缺失（問卷上線前上架的一般卡，不是成人卡） */
  rating?: Rating | null;
  /** 法規要標示的情節名稱，照級別由高到低 */
  ratingDescriptors?: Topic[];
  /** 成人卡「加到主畫面」的鑰匙：只有過了成人門的人拿得到，帶在 manifest 與圖示網址上（lib/card-manifest.ts）。 */
  shortcutKey?: string;
  /** HearthRoom 精選卡：社群代表標的；供應商那邊據此給作者較高的返點 */
  featured?: boolean;
  name: string;
  summary: string;
  names: Localized;
  summaries: Localized;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  /** 作者畫的分享圖（1.91:1，連結預覽用）；null 或不帶＝沒有 */
  shareImageUrl?: string | null;
  /** 作者的橫式背景圖（16:9）；卡片頁拿它當頂部橫幅。null＝沒有 */
  landscapeUrl?: string | null;
  slug: string | null;
  tags: string[];
  /** 原作：改編或致敬的作品名（伺服器照 lang 挑過）；沒有就是空字串或不帶 */
  fandom?: string;
  /** 原作的篩選鍵（對到 Wikidata 的是 wd:Q…）；fandomLabels 是它各語言的名字，照介面語言挑（lib/fandom.ts） */
  fandomKey?: string;
  fandomLabels?: Record<string, string>;
  /** handle 是作者的本站公開 ID；作者還沒成為成員時是 null，畫成純文字。accountNumId 是上游的數字 ID，只給編輯器與快取鍵用。 */
  author: { handle: string | null; accountNumId: number; name: string; avatar: string };
  talkNum: number;
  followNum: number;
  favoriteCount?: number;
  trending: number;
  registeredAt: number;
  syncedAt: number;
  /** 本站永久數字卡號，私有卡與公開卡共用同一套編號。 */
  num?: number;
  /**
   * 連結可讀、尚未上榜的卡也會帶回：這張卡在本站的狀態（unlisted＝還沒提交過）。
   * 在榜的卡沒有這個欄位。
   */
  status?: "unlisted" | "pending" | "rejected" | "needs_review" | "unshared" | "approved";
}

export interface CardPage {
  items: CommunityCard[];
  /** 有篩選且還有下一頁時為 null——精確總數在那種查詢下太貴，見服務端 listCards 的說明。 */
  total: number | null;
  hasNext: boolean;
  limit: number;
  offset: number;
  sort: Sort;
  /** 伺服器回的這一份含不含成人內容（X-Adult-Content）。舊伺服器沒有這個標頭時是 undefined。 */
  adult?: boolean;
  /** 幾個詞全部符合的沒有、改列任一符合的：畫面要說清楚 */
  partial?: boolean;
}
/** 榜的種類（照魅魔島）：日／週／月榜開窗、最熱、最新、推薦（隨機）；relevance 只給搜尋。 */
export type Sort = "day" | "week" | "month" | "hot" | "new" | "random" | "relevance";

export interface Author {
  bio?: string;
  /** 本站公開 ID（作者頁的網址）；null 表示還沒成為成員。 */
  handle: string | null;
  accountNumId: number;
  name: string;
  avatar: string;
  cardCount: number;
  talkTotal: number;
  /** 這個同步窗口的對話增量加總。只有榜單／搜尋列表帶，單人主頁沒有。 */
  trending?: number;
  joinedAt: number;
  /** 這位作者的卡發布在哪些供應商上；只有單人主頁帶。 */
  providers?: string[];
}
export type AuthorSort = "talk" | "cards" | "hot";

/** 上游的角色卡（作者自己的視角）。 */
export interface MyRole {
  roleId: string;
  zone: Zone | "all";
  name: string;
  summary: string;
  avatarUrl: string | null;
  visibility: string;
  talkNum: number;
}
