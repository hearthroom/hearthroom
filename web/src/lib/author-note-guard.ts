// i18n-ignore：下面的中文是伺服器回的類別名（作者說明的內部字詞檢查），是協定裡的識別字，不是介面文字
import type { AuthorNoteInternal } from "./api";

/**
 * 給作者看的說明命中內部字詞（400 author_note_internal）時，畫面上逐項列出：類別 chip、原句片段（命中的字標底色）、改寫提示。
 * 伺服器的類別名對到語系檔的 reviewAi.guard.term.<kind> 與 reviewAi.guard.hint.<kind>。
 */
export const GUARD_KINDS = ["quota", "pace", "device", "account", "score", "tier"] as const;
export type GuardKind = (typeof GUARD_KINDS)[number];
const KIND_OF: Record<string, GuardKind> = { 額度: "quota", 送審次數: "pace", 裝置: "device", 帳號: "account", 分數: "score", 作者等級: "tier" };

export interface GuardHit {
  /** null＝伺服器多了畫面還不認得的類別：照原字顯示、不給提示 */
  kind: GuardKind | null;
  term: string;
  /** 原句片段切成三段，中間那段是命中的字；舊版伺服器只回 terms，沒有片段 */
  snippet: { before: string; hit: string; after: string } | null;
}

export function guardHits(info: AuthorNoteInternal): GuardHit[] {
  const out: GuardHit[] = [];
  const seen = new Set<string>();
  for (const m of info.matches) {
    if (seen.has(m.term)) continue;
    seen.add(m.term);
    const start = Math.min(Math.max(0, m.start), m.snippet.length);
    const end = Math.min(m.snippet.length, start + Math.max(0, m.length));
    out.push({ kind: KIND_OF[m.term] ?? null, term: m.term, snippet: { before: m.snippet.slice(0, start), hit: m.snippet.slice(start, end), after: m.snippet.slice(end) } });
  }
  for (const term of info.terms) {
    if (seen.has(term)) continue;
    seen.add(term);
    out.push({ kind: KIND_OF[term] ?? null, term, snippet: null });
  }
  return out;
}
