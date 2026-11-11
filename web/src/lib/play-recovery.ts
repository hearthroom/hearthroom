import { fetchCard } from './api';
import { copies } from './distribution';
import type { ProviderId } from './provider';

/** A recovery link is offered only after the existing source API verifies ownership. */
export async function authorPlaytest(id: string, provider: ProviderId, language: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (async () => {
    const card = await fetchCard(id, language, { quiet: true });
    const number = String(card.num ?? card.id);
    if (card.provider !== provider || !/^[1-9]\d*$/.test(number)) return null;
    const source = card.sourceRoleId ?? card.roleId;
    if (!source) return null;
    const owned = await copies(source, provider);
    return owned.some(copy => copy.provider === provider && copy.roleId && ['source', 'synced', 'pending', 'published'].includes(copy.status)) ? number : null;
  })().catch(() => null);
  try {
    return await Promise.race([check, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
  } finally { clearTimeout(timer); }
}
