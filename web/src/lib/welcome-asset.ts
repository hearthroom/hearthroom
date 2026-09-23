import { fetchCardPlatforms, fetchPlayerAsset, fetchRoleDetail, type CardPlatform, type PlayerAsset } from './api';
import { accountToken } from './connections';
import type { ProviderId } from './provider';

/** Display-only assets: provider permissions remain authoritative, including for guests. */
export async function fetchWelcomeAsset(
  cardId: string,
  source: { provider: ProviderId; roleId: string },
  welcome: string,
  lang: string,
  pending?: Promise<CardPlatform[]>,
): Promise<PlayerAsset | null> {
  // Public previews do not depend on the viewer having linked this provider.
  const publicAsset = await fetchPlayerAsset(source.roleId, undefined, source.provider).catch(() => null);
  if (publicAsset) return publicAsset;
  const token = await accountToken(source.provider).catch(() => null);
  if (token) {
    const ownAsset = await fetchPlayerAsset(source.roleId, token, source.provider).catch(() => null);
    if (ownAsset) return ownAsset;
  }
  // Discovery enforces community visibility and returns the approved version's replicas.
  // Never guess a host ID, forward another provider's token, or read author-only settings.
  const platforms = await (pending ?? fetchCardPlatforms(cardId)).catch(() => []);
  for (const copy of platforms) {
    if (copy.provider === source.provider && copy.roleId === source.roleId) continue;
    try {
      // Legacy distributed copies can lag behind: don't apply rules to a different opening.
      const detail = await fetchRoleDetail(copy.roleId, undefined, lang, copy.provider);
      if (String(detail.roleWelcome ?? '') !== welcome) continue;
      const asset = await fetchPlayerAsset(copy.roleId, undefined, copy.provider);
      if (asset) return asset;
    } catch { /* An inaccessible copy cannot provide the preview. */ }
  }
  return null;
}
