/**
 * 對話頁頁首的收藏與留言。
 *
 * 舞台只認得供應商的 roleId，收藏與留言掛在本站的卡（cards.id）上。PlayPage 開卡時把「這個 roleId
 * 是本站哪一張、是不是公開那一張」登記在這裡，舞台透過宿主介面（stage-host 的 card）來問、來改、
 * 來開留言區。留言區由 PlayPage 畫（PlayComments），用的是卡片頁同一個留言元件。
 *
 * 只有上架中的公開卡才有：作者試玩（mode=source）、審核、找不到卡都不登記，兩顆就不畫。
 */
import { reactive } from "vue";
import { fetchRoleDetail } from "@/lib/api";
import { libraryRequest } from "@/lib/library";
import type { ProviderId } from "@/lib/provider";

export interface PlaySocialCard { roleId: string; cardId: string; provider: ProviderId }

export const playSocial = reactive<{ card: PlaySocialCard | null; commentsOpen: boolean }>({ card: null, commentsOpen: false });

export function registerPlayCard(card: PlaySocialCard | null): void {
  playSocial.card = card;
  playSocial.commentsOpen = false;
}

export interface PlaySocialDeps {
  /** 本站登入的成員；沒登入不能收藏（留言區自己會帶去登入）。 */
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
      const [detail, favorite] = await Promise.all([
        // 作者在卡片主頁關掉留言區的話，對話頁也不開
        fetchRoleDetail(card.roleId, undefined, deps.lang(), card.provider).catch(() => null),
        token ? libraryRequest<{ active: boolean }>(`favorites/${encodeURIComponent(card.cardId)}`, token).catch(() => null) : Promise.resolve(null),
      ]);
      if (current(roleId) !== card) return null;
      return { favorite: !!favorite, favorited: !!favorite?.active, comments: detail?.previewShowComments !== false };
    },
    async setFavorite(roleId: string, on: boolean) {
      const card = current(roleId);
      const token = card && deps.signedIn() ? await deps.token() : null;
      if (!card || !token) throw new Error("unavailable");
      const result = await libraryRequest<{ active: boolean }>(`favorites/${encodeURIComponent(card.cardId)}`, token, on ? "PUT" : "DELETE");
      return result.active;
    },
    openComments(roleId: string) {
      if (current(roleId)) playSocial.commentsOpen = true;
    },
  };
}
