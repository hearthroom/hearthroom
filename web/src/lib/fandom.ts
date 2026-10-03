import type { CommunityCard } from "./types";

/** 介面語言 → 試哪些 Wikidata 語言鍵。跟伺服器那份同一個順序。 */
const ORDER: Record<string, string[]> = {
  "zh-Hant": ["zh-hant", "zh-tw", "zh-hk", "zh", "zh-hans", "zh-cn", "en", "ja"],
  "zh-Hans": ["zh-hans", "zh-cn", "zh", "zh-hant", "zh-tw", "zh-hk", "en", "ja"],
  ja: ["ja", "en", "zh-hant", "zh"],
  ko: ["ko", "en", "ja", "zh-hant", "zh"],
  en: ["en", "ja", "zh-hant", "zh"],
};
export function fandomLabel(labels: Record<string, string> | undefined, locale: string): string {
  if (!labels) return "";
  for (const key of ORDER[locale] ?? ORDER.en!) if (labels[key]) return labels[key]!;
  return Object.values(labels)[0] ?? "";
}
/** 卡上的原作，照介面語言出：對到 Wikidata 的有各語言名，自由文字就是作者打的 */
export const cardFandom = (card: Pick<CommunityCard, "fandom" | "fandomLabels">, locale: string): string => fandomLabel(card.fandomLabels, locale) || card.fandom || "";
