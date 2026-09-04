export interface Localized { zh: string; en: string; ja: string; ko: string }

/** 語區。榜單按這個分開列；all 是不分語言的卡，每區都出現。 */
export type Zone = "zh" | "en" | "ja" | "ko";

export interface CommunityCard {
  id: string;
  roleId: string;
  zone: Zone | "all";
  name: string;
  summary: string;
  names: Localized;
  summaries: Localized;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  slug: string | null;
  tags: string[];
  author: { accountNumId: number; name: string; avatar: string };
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
export type Sort = "hot" | "new" | "top" | "relevance";

export interface Author {
  accountNumId: number;
  name: string;
  avatar: string;
  cardCount: number;
  talkTotal: number;
  /** 這個同步窗口的對話增量加總。只有榜單／搜尋列表帶，單人主頁沒有。 */
  trending?: number;
  joinedAt: number;
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
