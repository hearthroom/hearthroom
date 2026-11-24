import { HttpError } from "./types";

/**
 * 給作者看的說明不能帶內部資訊（owner 2026-11-24）：作者行為、送審額度與次數、同裝置與帳號、AI 的分數與信心。
 * 這些是審核員判斷的參考，作者看到只會覺得被監視，也會教人怎麼繞過。只擋明確的內部字詞，寫卡片本身（開場白、設定、世界書）不受影響。
 */
const INTERNAL_TERMS: { term: string; pattern: RegExp }[] = [
  { term: "額度", pattern: /額度|额度|quota/i },
  { term: "送審次數", pattern: /送審次數|送审次数|送審頻率|送审频率|送審節奏|送审节奏|submission (count|rate|frequency)/i },
  { term: "裝置", pattern: /裝置|装置|設備|设备|device/i },
  { term: "帳號", pattern: /帳號|账号|帳戶|账户|分身|小號|小号|account/i },
  { term: "分數", pattern: /分數|分数|信心|置信|confidence|score/i },
  { term: "作者等級", pattern: /作者等級|作者等级|熟面孔|author tier/i },
];

export function internalTermsIn(text: string): string[] {
  return INTERNAL_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.term);
}

/** 每個命中的類別附原句片段（前後各 12 字）與命中的字在片段裡的位置，畫面據此標底色 */
export function internalMatches(text: string): { term: string; snippet: string; start: number; length: number }[] {
  return INTERNAL_TERMS.flatMap((t) => {
    const m = t.pattern.exec(text);
    if (!m) return [];
    const from = Math.max(0, m.index - 12);
    return [{ term: t.term, snippet: text.slice(from, m.index + m[0].length + 12), start: m.index - from, length: m[0].length }];
  });
}

/** 審核員送出的作者說明命中內部字詞：擋下並告訴他是哪幾個詞、在哪一句，請他改寫 */
export function guardAuthorNote(text: string): void {
  const matches = internalMatches(text);
  if (matches.length) throw new HttpError(400, "author_note_internal", undefined, { field: "note", terms: matches.map((m) => m.term), matches });
}
