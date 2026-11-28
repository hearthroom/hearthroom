import { i18n } from "./i18n";

/*
 * 卡片品質信號的數字怎麼寫（設計定稿 ui.md「字數一律取整」，owner 2026-11-28）。
 * 伺服器已經照同一套級距取整（shared/card-quality-length.ts：未滿 10 萬取到千、以上取到萬，0＝不到 1,000），
 * 這裡只負責換成各語言的寫法，不再四捨五入第二次：
 *   中日韓用「萬」：未滿 1 萬寫全數（3,000 字）；1 萬起一位小數的萬（1.4 萬字）；10 萬起整數萬（11 萬字），不往上換「億」。
 *   英文用 k／M：3,000 chars、14k chars、110k chars、1.1M chars。
 * 條數與人數照實，不走這裡。
 */
const locale = () => String(i18n.global.locale.value);
const t = (key: string, params: Record<string, unknown>) => i18n.global.t(key, params);
const number = (n: number, digits = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n);

export function qualityCharacters(rounded: number): string {
  if (rounded < 1000) return t("quality.chars.under", { n: number(1000) });
  if (rounded < 10_000) return t("quality.chars.plain", { n: number(rounded) });
  // 英文一千一級（k、M）；中日韓一萬一級，到百萬也還是「萬」。個位數的值留一位小數（1.4 萬、1.1M），其餘整數。
  const [unit, hugeUnit] = locale().startsWith("en") ? [1000, 1_000_000] : [10_000, 10_000];
  const huge = rounded >= 1_000_000;
  const value = rounded / (huge ? hugeUnit : unit);
  return t(huge ? "quality.chars.huge" : "quality.chars.large", { n: number(value, value < 10 ? 1 : 0) });
}

/** 續玩率：伺服器給 0–100 的整數（已無條件捨去），這裡只照語言寫成百分比（82%）。 */
export function qualityRate(rate: number): string {
  return new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 }).format(rate / 100);
}
