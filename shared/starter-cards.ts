/**
 * 新手引導的入門卡（owner 2026-10-10）：第一次來的訪客，首頁的引導帶他進這張卡。
 * 依語言分組：簡體與繁體共用一張（內容會自動翻譯），英、日、韓各一張。
 * general 是一般版，人人都看得到；adult 是成人版，只在看的人開了成人內容時帶他去。
 * 填卡號（卡片頁網址上的數字）。沒填 general 的那一組不出現引導。卡由營運寫好再填。
 */
export type StarterGroup = "zh" | "en" | "ja" | "ko";
export const STARTER_CARDS: Record<StarterGroup, { general: number | null; adult: number | null }> = {
  zh: { general: 100188, adult: null },
  en: { general: null, adult: null },
  ja: { general: null, adult: null },
  ko: { general: null, adult: null },
};
