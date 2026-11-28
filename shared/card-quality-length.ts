import { effectiveCharacters } from './review-count';
import type { CardQualityLength } from './card-quality';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function roundQualityCharacters(characters: number): number {
  if (characters < 1000) return 0;
  const step = characters < 100_000 ? 1000 : 10000;
  return Math.round(characters / step) * step;
}

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { return null; }
}

/** Same text and buckets for the sealed version and the editor's current draft. */
export function cardQualityLength(settings: Record<string, unknown>): CardQualityLength {
  const document = record(settings.document);
  const greetings = record(settings.greetings);
  const asset = record(settings.authorAsset);
  const counts = new Map<string, number>();
  const count = (value: unknown): { present: boolean; characters: number } => {
    if (!hasText(value)) return { present: false, characters: 0 };
    const existing = counts.get(value);
    if (existing !== undefined) return { present: existing > 0, characters: 0 };
    const characters = effectiveCharacters(value);
    counts.set(value, characters);
    return { present: characters > 0, characters };
  };

  let setting = 0;
  for (const value of [
    document.roleDetailDesc,
    hasText(document.customInstructions) ? document.customInstructions : document.jailbreak,
    document.roleOutputContract,
    ...array(parse(document.talkExample)).map(turn => record(turn).content),
  ]) setting += count(value).characters;

  for (const memberValue of array(record(parse(document.world)).characters)) {
    const member = record(memberValue);
    setting += count(member.profile).characters + count(member.description).characters;
  }

  let worldbookCharacters = 0;
  let entries = 0;
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : [settings.worldbook];
  for (const value of books) {
    const book = record(value);
    if (book.isActive === false) continue;
    const groups = new Set<string>();
    for (const entryValue of array(book.entries)) {
      const entry = record(entryValue);
      if (entry.isEnabled === false) continue;
      const result = count(entry.content);
      if (!result.present) continue;
      worldbookCharacters += result.characters;
      const group = record(entry.matchOptions).groupId;
      if (hasText(group)) groups.add(group);
      else entries++;
    }
    entries += groups.size;
  }

  let openings = 0;
  let openingCharacters = 0;
  for (const value of [greetings.welcome, ...array(greetings.alternates), ...array(greetings.prologue)]) {
    const result = count(value);
    if (!result.present) continue;
    openings++;
    openingCharacters += result.characters;
  }
  return {
    total: roundQualityCharacters(setting + worldbookCharacters + openingCharacters),
    setting: setting > 0 ? roundQualityCharacters(setting) : null,
    worldbook: { entries, characters: roundQualityCharacters(worldbookCharacters) },
    openings: { count: openings, characters: roundQualityCharacters(openingCharacters) },
    presentation: {
      openingPage: asset.openingPageExpired !== true &&
        (hasText(asset.openingPage) || (typeof asset.openingPageBytes === 'number' && asset.openingPageBytes > 0)),
      displayRules: array(asset.rules).length,
      panel: hasText(asset.mountTrigger),
    },
  };
}
