import { HttpError } from "./types";

/**
 * 給作者看的說明不能帶內部資訊（owner 2026-11-24）：作者行為、送審額度與次數、同裝置與帳號、AI 的分數與信心。
 * 這些是審核員判斷的參考，作者看到只會覺得被監視，也會教人怎麼繞過。只擋明確的內部字詞，寫卡片本身（開場白、設定、世界書）不受影響。
 */
// 只擋帶內部語境的說法：單獨的「信心」「裝置」「設備」「分身」「帳號」「account」「device」常是卡片內容本身
// （自信心、科幻裝置、分身角色、故事裡的帳號、plot device），擋了會讓審核員寫不出正常的修改建議。
// 類別名（term）固定：網頁依它對到 reviewAi.guard.term.<kind> 與改寫提示。
const COUNT = String.raw`(?:多|好幾|好几|幾|几|數|数|\d+|[一二兩两三四五六七八九十]+)\s*(?:個|个)?`;
const INTERNAL_TERMS: { term: string; pattern: RegExp }[] = [
  { term: "額度", pattern: /額度|额度|\bquotas?\b/i },
  { term: "送審次數", pattern: /送審(?:次數|頻率|節奏|數量|太頻繁|太頻|太多)|送审(?:次数|频率|节奏|数量|太频繁|太频|太多)|批量(?:產|产|生產|生产)|量(?:產|产)(?:卡|的卡|工作室)|(?:疑似|是)量(?:產|产)|工作室(?:量產|量产|批量)|\bsubmission (?:count|rate|frequency|pace)s?\b|\bmass[- ]produced\b|\bcard (?:mill|farm)s?\b/i },
  { term: "裝置", pattern: /同(?:一)?(?:個|个|台|部|支)?\s*(?:裝置|设备|設備|装置|手機|手机|電腦|电脑|IP)|(?:IP|ＩＰ)\s*(?:相同|一樣|一样)|\bsame (?:device|ip|phone|computer)\b|\bdevice (?:id|fingerprint|hash)\b/i },
  { term: "帳號", pattern: new RegExp(String.raw`${COUNT}(?:帳號|账号|帳戶|账户)|小號|小号|分身(?:帳號|账号)|\b(?:alt|multiple|duplicate|sock ?puppet) accounts?\b`, "i") },
  { term: "分數", pattern: /信心分數|信心分数|置信|信心(?:值|度|分)|AI\s*(?:的)?\s*(?:信心|把握)|AI\s*(?:分數|分数|評分|评分)|(?:風險|风险)(?:分數|分数)|\bconfidence (?:score|level)s?\b|\b(?:AI|risk) scores?\b/i },
  { term: "作者等級", pattern: /作者等級|作者等级|熟面孔|\bauthor (?:tier|level|rank)s?\b/i },
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
