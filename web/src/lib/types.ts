export interface Localized { zh: string; en: string; ja: string; ko: string }

export interface CommunityCard {
  id: string;
  roleId: string;
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

export interface CardPage { items: CommunityCard[]; total: number; limit: number; offset: number; sort: Sort }
export type Sort = "hot" | "new" | "top";

export interface Author {
  accountNumId: number;
  name: string;
  avatar: string;
  cardCount: number;
  talkTotal: number;
  joinedAt: number;
}

/** 上游的角色卡（作者自己的視角）。 */
export interface MyRole {
  roleId: string;
  name: string;
  summary: string;
  avatarUrl: string | null;
  visibility: string;
  talkNum: number;
}
