import { currentProvider, type ProviderId } from './provider';

/** A play URL chooses this game's service, never the community's signed-in identity. */
export function playProvider(raw: unknown): ProviderId {
  if (raw === undefined || raw === null || raw === '') return currentProvider();
  if (raw === 'harbor' || raw === 'lunatalk') return raw;
  throw new Error('unknown_play_provider');
}
