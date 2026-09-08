export interface Localized { zh: string; en: string; ja: string; ko: string }

/** 語區。榜單按這個分開列；all 是不分語言的卡，每區都出現。 */
export type Zone = "zh" | "en" | "ja" | "ko";

export interface CommunityCard {
  id: string;
  roleId: string;
  zone: Zone | "all";
  /** 支援哪家供應商（供應商代號）：拿那家的帳號在本站玩。 */
  provider?: string;
  /** 成人內容（本站的分級，作者宣告、審核人對照過） */
  nsfw?: boolean;
  name: string;
  summary: string;
  names: Localized;
  summaries: Localized;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  slug: string | null;
  tags: string[];
  /** handle 是作者的本站公開 ID；作者還沒成為成員時是 null，畫成純文字。accountNumId 是上游的數字 ID，只給編輯器與快取鍵用。 */
  author: { handle: string | null; accountNumId: number; name: string; avatar: string };
  talkNum: number;
  followNum: number;
  trending: number;
  registeredAt: number;
  syncedAt: number;
}

export interface CardPage {
  items: CommunityCard[];
  /** 有篩選且還有下一頁時為 null——精確總數在那種查詢下太貴，見服務端 listCards 的說明。 */
  total: number | null;
  hasNext: boolean;
  limit: number;
  offset: number;
  sort: Sort;
}
/** 榜的種類（照魅魔島）：日／週／月榜開窗、最熱、最新、推薦（隨機）；relevance 只給搜尋。 */
export type Sort = "day" | "week" | "month" | "hot" | "new" | "random" | "relevance";

export interface Author {
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
