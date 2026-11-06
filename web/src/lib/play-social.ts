/**
 * 對話頁頁首的收藏與卡片資訊。
 *
 * 舞台只認得供應商的 roleId，收藏、評論、榜單掛在本站的卡（cards.id）上。PlayPage 開卡時把「這個 roleId
 * 是本站哪一張、是不是公開那一張」連同讀到的卡片資料登記在這裡，舞台透過宿主介面（stage-host 的 card）
 * 來問、來改、來開卡片資訊面板。面板由 PlayPage 畫（PlayInfoPanel），疊在畫布上，畫布與沙盒都不動。
 *
 * 只有上架中的公開卡才有：作者試玩（mode=source）、審核、找不到卡都不登記，兩顆就不畫。
 * 作者在卡片主頁關掉留言區時，入口照樣在，只是面板裡沒有評論分頁（跟卡片頁整塊不放一致）。
 */
import { reactive, watch, type InjectionKey } from "vue";
import { fetchRoleDetail } from "@/lib/api";
import { libraryRequest } from "@/lib/library";
import type { ProviderId } from "@/lib/provider";
import type { CommunityCard } from "@/lib/types";

export interface PlaySocialCard {
  roleId: string; cardId: string; provider: ProviderId;
  /** PlayPage 開卡時讀到的那份卡片資料：面板一打開就畫得出來，不必等請求 */
  card?: CommunityCard | null;
}
export type PlayInfoTab = "info" | "comments" | "rankings";
/**
 * 卡片資訊面板提供給它重用的元件（含經 Teleport 開出的完整知音榜）：站內連結改開新分頁、指回主站。
 * 同分頁換頁會把遊玩頁與沙盒卸掉；卡片 App 網域上只有對話頁。登入連結不吃這個，照舊同分頁。
 */
export const PLAY_PANEL_LINKS: InjectionKey<boolean> = Symbol("play-panel-links");
/** 來源端的卡片詳情：作者寫的介紹（Markdown 原文）與評論開關 */
export interface PlaySocialDetail { readme: string; comments: boolean }

export const playSocial = reactive<{
  card: PlaySocialCard | null;
  open: boolean;
  /** 面板目前的分頁；關掉再開回到上次那一頁，換卡回到資訊 */
  tab: PlayInfoTab;
  /** social() 讀到才有；讀不到時當作評論開著（跟卡片頁一樣） */
  detail: PlaySocialDetail | null;
  /** 詳情讀取的狀態：資訊分頁據此畫介紹的骨架，或錯誤與「重新載入」 */
  detailStatus: "idle" | "loading" | "ready" | "failed";
}>({ card: null, open: false, tab: "info", detail: null, detailStatus: "idle" });

export function registerPlayCard(card: PlaySocialCard | null): void {
  playSocial.card = card;
  playSocial.open = false;
  playSocial.tab = "info";
  playSocial.detail = null;
  playSocial.detailStatus = "idle";
}

/** 讀來源端的卡片詳情（介紹與評論開關）。只有最後一次讀取寫得進來：途中換了卡、或又按了重新載入，舊的那次就不寫。 */
let detailGeneration = 0;
async function loadDetail(card: PlaySocialCard, lang: string): Promise<void> {
  const generation = ++detailGeneration;
  const latest = () => generation === detailGeneration && playSocial.card === card;
  playSocial.detailStatus = "loading";
  try {
    const detail = await fetchRoleDetail(card.roleId, undefined, lang, card.provider);
    if (!latest()) return;
    playSocial.detail = { comments: detail.previewShowComments !== false, readme: typeof detail.roleReadme === "string" ? detail.roleReadme : "" };
    playSocial.detailStatus = "ready";
  } catch {
    if (latest()) playSocial.detailStatus = "failed";
  }
}

/** 資訊分頁的「重新載入」。 */
export function reloadPlayDetail(lang: string): Promise<void> {
  const card = playSocial.card;
  return card ? loadDetail(card, lang) : Promise.resolve();
}

export interface PlaySocialDeps {
  /** 本站登入的成員；沒登入不能收藏（評論區自己會帶去登入）。 */
  signedIn: () => boolean;
  token: () => Promise<string | null>;
  lang: () => string;
}

function current(roleId: string): PlaySocialCard | null {
  const card = playSocial.card;
  return card && card.roleId === roleId ? card : null;
}

/** 舞台的 StageHost.card。 */
export function playSocialHost(deps: PlaySocialDeps) {
  return {
    async social(roleId: string) {
      const card = current(roleId);
      if (!card) return null;
      const token = deps.signedIn() ? await deps.token().catch(() => null) : null;
      const [, favorite] = await Promise.all([
        // 介紹與評論開關給面板用；這一趟本來就要問評論開關，介紹順便帶回來
        loadDetail(card, deps.lang()),
        token ? libraryRequest<{ active: boolean }>(`favorites/${encodeURIComponent(card.cardId)}`, token).catch(() => null) : Promise.resolve(null),
      ]);
      if (current(roleId) !== card) return null;
      return { favorite: !!favorite, favorited: !!favorite?.active };
    },
    async setFavorite(roleId: string, on: boolean) {
      const card = current(roleId);
      const token = card && deps.signedIn() ? await deps.token() : null;
      if (!card || !token) throw new Error("unavailable");
      const result = await libraryRequest<{ active: boolean }>(`favorites/${encodeURIComponent(card.cardId)}`, token, on ? "PUT" : "DELETE");
      return result.active;
    },
    /** 同一顆鍵開也收（桌機面板沒有遮罩，頁首入口一直按得到）。 */
    toggleInfo(roleId: string) {
      if (current(roleId)) playSocial.open = !playSocial.open;
    },
    onInfoChange(fn: (open: boolean) => void): () => void {
      return watch(() => playSocial.open, fn);
    },
  };
}
