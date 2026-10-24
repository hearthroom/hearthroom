import { fetchCard, fetchCardPlatforms, fetchReviewDetail } from './api';
import { copies } from './distribution';
import { libraryRequest } from './library';
import type { ProviderId } from './provider';
import { fetchOwnedHistory, type HistoryAccessReason } from './owned-history';

interface PlayCardResolved {
 card: Awaited<ReturnType<typeof fetchCard>> | null; number: string; roleId: string;
 conversationId?: string; readOnly?: boolean; reason?: HistoryAccessReason; title?: string;
}

/** Public URLs identify the work; only the selected host's role ID reaches Stage. */
export async function resolvePlayCard(id: string, provider: ProviderId, language: string, source = false, review?: { id: string; token: string }, resume?: { id: string; token: string; providerToken?: string }): Promise<PlayCardResolved> {
  if (review) {
    const detail = await fetchReviewDetail(review.id, review.token);
    if (String(detail.card.id) !== id) throw new Error('review_card_mismatch');
    return { card: null, number: String(detail.card.id), roleId: detail.card.roleId };
  }
  // Verify the private pointer and actual Provider ownership before any public read.
  const previous = resume ? await libraryRequest<{cardNumber:number;provider:ProviderId;roleId:string;canResumeExact?:boolean}>(
    `conversations/${encodeURIComponent(resume.id)}?provider=${provider}`, resume.token) : null;
  if (previous && resume) {
    if ((String(previous.cardNumber) !== id && previous.roleId !== id) || previous.provider !== provider) throw new Error('conversation_card_mismatch');
    const owned = await fetchOwnedHistory(provider, resume.id, resume.providerToken ?? resume.token);
    if (owned.conversationId !== resume.id || owned.roleId !== previous.roleId) throw new Error('conversation_card_mismatch');
    if (!owned.canGenerate) return {card:null,number:String(previous.cardNumber ?? previous.roleId),roleId:owned.roleId,
      conversationId:owned.conversationId,readOnly:true,reason:owned.reason ?? 'unavailable',title:owned.title};
  }
  const early = /^[1-9]\d*$/.test(id);
  const platformRequest = !source && early ? fetchCardPlatforms(id) : null;
  platformRequest?.catch(() => {});
  let card: Awaited<ReturnType<typeof fetchCard>>;
  try { card = await fetchCard(id, language, { quiet: true }); }
  catch(error) {
    // A playable owned revision can outlive the current share target. Keep the
    // community moderation/sync fence as well as Provider ownership: a generic
    // 404 alone must never revive a locally suspended work.
    if(previous?.canResumeExact===true&&(error as {status?:unknown})?.status===404)
      return {card:null,number:String(previous.cardNumber??previous.roleId),roleId:previous.roleId};
    throw error;
  }
  const number = String(card.num ?? card.id);
  if (!/^[1-9]\d*$/.test(number)) throw new Error('card_number_unavailable');
  if (previous) {
    if (String(previous.cardNumber) !== number || previous.provider !== provider) throw new Error('conversation_card_mismatch');
    // 紀錄記的是當時玩的版本；作者更新後改開目前上架的版本，伺服器開局時會把舊版上的對話接過來，
    // 像遊戲更新一樣接著玩。卡片下架或這個平台暫時不能玩時，才回到紀錄上的版本。
    const current = await (platformRequest && number === id ? platformRequest : fetchCardPlatforms(number)).catch(() => []);
    const copy = current.find(p => p.provider === provider && p.playable && p.roleId);
    return {card, number, roleId: copy?.roleId || previous.roleId};
  }
  // Author playtests use the saved source, not the approved snapshot. This API
  // verifies source ownership before returning any draft copy.
  const platforms = source
    ? (await copies(card.sourceRoleId ?? card.roleId, card.provider as ProviderId))
      .filter(copy => ['source', 'synced', 'pending', 'published'].includes(copy.status))
      .map(copy => ({ ...copy, playable: true }))
    : platformRequest && number === id ? await platformRequest : await fetchCardPlatforms(number);
  const copy = platforms.find(p => p.provider === provider && p.playable && p.roleId);
  if (!copy?.roleId) throw new Error('card_host_unavailable');
  return { card, number, roleId: copy.roleId };
}
