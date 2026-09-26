import { fetchCard, fetchCardPlatforms, fetchReviewDetail } from './api';
import { copies } from './distribution';
import { libraryRequest } from './library';
import type { ProviderId } from './provider';

/** Public URLs identify the work; only the selected host's role ID reaches Stage. */
export async function resolvePlayCard(id: string, provider: ProviderId, language: string, source = false, review?: { id: string; token: string }, resume?: { id: string; token: string }) {
  if (review) {
    const detail = await fetchReviewDetail(review.id, review.token);
    if (String(detail.card.id) !== id) throw new Error('review_card_mismatch');
    return { card: null, number: String(detail.card.id), roleId: detail.card.roleId };
  }
  // 網址上已經是卡號時，卡片、續玩紀錄、可玩平台三件事一起問，不必一件等一件（開卡前省一趟往返）。
  // 對照與檢查照舊在卡片回來之後做；卡號跟網址對不上時，平台清單用卡片上的卡號重問。
  const early = /^[1-9]\d*$/.test(id);
  const previousRequest = resume
    ? libraryRequest<{ cardNumber: number; provider: ProviderId; roleId: string }>(
      `conversations/${encodeURIComponent(resume.id)}?provider=${provider}`, resume.token)
    : null;
  const platformRequest = !resume && !source && early ? fetchCardPlatforms(id) : null;
  // 卡片那一步先失敗時，這兩個結果沒人等；先掛上處理，免得變成未處理的拒絕。
  previousRequest?.catch(() => {});
  platformRequest?.catch(() => {});
  const card = await fetchCard(id, language, { quiet: true });
  const number = String(card.num ?? card.id);
  if (!/^[1-9]\d*$/.test(number)) throw new Error('card_number_unavailable');
  if (previousRequest) {
    const previous = await previousRequest;
    if (String(previous.cardNumber) !== number || previous.provider !== provider) throw new Error('conversation_card_mismatch');
    return {card, number, roleId: previous.roleId};
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
