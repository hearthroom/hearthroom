/**
 * 卡片標題怎麼擺。
 *
 * 不少作者在來源平台上把標題當成一塊招牌來排：裝飾符號包住中文名、下一行接花體英文、
 * 或把英文字母一個個拉開。來源平台的標題是置中顯示的，作者靠「在空格處換行」把它排成
 * 上下兩段。這裡照搬一般名字的靠左、逐字換行，這種標題就會在符號中間被切斷、偏向一側。
 *
 * 所以分兩種：
 * - 排過版的：置中，只在作者留的空格處換行（一段本身比欄位還寬時才在段內斷）。
 * - 沒排過版的：照常靠左，塞滿兩行。單純很長的名字屬於這種——置中只會讓它更難讀。
 *
 * 判斷只看標題文字本身，寧可漏判（照常靠左，跟以前一樣）也不要誤判一般長名字。
 */

// 花體、粗體、雙線等數學字母區塊：𝓗𝓸𝓷𝓴𝓪𝓲、𝕲𝖊𝖓𝖘𝖍𝖎𝖓
const STYLED_LETTERS = /[\u{1D400}-\u{1D7FF}]/u;
// 常被拿來當框的幾個標點：꧁ ꧂ ⟅ ⟆ 「┆」這類不在符號類別裡的
const FRAME_MARKS = /[\u{A9C1}-\u{A9CD}⟅⟆⸨⸩]/u;
// 只看圖形符號（✦ ❖ ┆）；數學符號（｜ ～ × →）在一般標題裡常當分隔或語氣用，不算排版
const SYMBOL = /\p{So}/u;
const EMOJI = /\p{Extended_Pictographic}/u;
// 至少四個單字母以空白隔開：D A N G A N R O N P A
const LETTER_SPACED = /(?:^|\s)(?:\p{L}\s){3,}\p{L}(?=\s|$)/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_WORD = /^\p{Script=Latin}+/u;

function hasDecoration(text: string): boolean {
  if (STYLED_LETTERS.test(text) || FRAME_MARKS.test(text)) return true;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 0x2000) continue;
    if (SYMBOL.test(ch) && !EMOJI.test(ch)) return true;
  }
  return false;
}

/**
 * 中文（日韓）一段、空格後接一段夠長的英文：弹丸论破 Danganronpa。
 * 「我的女友 Alice」這種短英文名只是名字的一部分，不當成兩段式招牌。
 */
function isBilingualLockup(text: string): boolean {
  if (!CJK.test(text)) return false;
  const latin = text.split(/\s+/).slice(1).filter((part) => LATIN_WORD.test(part) && !CJK.test(part));
  return latin.join("").replace(/[^\p{Script=Latin}]/gu, "").length >= 8;
}

// 各類字大約多寬（以字級為 1）。寧可估寬：估寬只是字小一點，估窄會讓一段又被切開。
// 標定：系統字 600 字重下 ꧁ ≈ 1.56、中日韓 1、✦ ≈ 0.8、大寫拉丁 ≈ 0.7、空格 ≈ 0.2。
const WIDE_FRAMES = /[\u{A9C1}-\u{A9CD}]/u;
const FULL_WIDTH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{So}\p{Sm}\u{1D400}-\u{1D7FF}\u3000-\u303F\uFF00-\uFFEF]/u;
function glyphWidth(ch: string): number {
  if (WIDE_FRAMES.test(ch)) return 1.6;
  if (FULL_WIDTH.test(ch)) return 1;
  if (/\s/.test(ch)) return 0.25;
  if (/\p{Lu}/u.test(ch)) return 0.72;
  if (/[\p{L}\p{N}]/u.test(ch)) return 0.62;
  return 0.6;
}

/** 字母拉開的那一段是一個字，不能在字母之間斷行：D A N G A N R O N P A */
function keepLetterSpacingTogether(text: string): string {
  return text.replace(new RegExp(LETTER_SPACED.source, "gu"), (run) => run.replace(/(?<=\p{L}) (?=\p{L})/gu, "\u00A0"));
}

/**
 * 中文一段、英文一段的招牌：在最後一個中日韓字之後的第一個空格換行，右邊不能再有中日韓字。
 * 作者沒傳換行，但這就是他在來源平台上要的兩行；不這樣做，寬欄位會把英文的前幾個字接到第一行。
 */
function splitPair(text: string): string {
  if (text.includes("\n")) return text;
  let lastCjk = -1;
  for (const m of text.matchAll(new RegExp(CJK.source, "gu"))) lastCjk = m.index;
  if (lastCjk < 0) return text;
  const gap = text.slice(lastCjk).search(/[ \t]/);
  if (gap < 0) return text;
  const left = text.slice(0, lastCjk + gap).trimEnd();
  const right = text.slice(lastCjk + gap).trim();
  return /\p{L}/u.test(right) ? `${left}\n${right}` : text;
}

export interface TitleLayout {
  text: string;
  /** 排過版：置中、只在作者留的空格換行；中英兩段的招牌已在 text 裡換好行 */
  designed: boolean;
  /** 最寬一段（兩個換行點之間）估計有幾個字寬；欄位放不下這一段時，把字級縮到剛好放得下 */
  widestEm: number;
}

export function titleLayout(name: string): TitleLayout {
  const trimmed = name.trim();
  const designed = trimmed.includes("\n") || hasDecoration(trimmed) || LETTER_SPACED.test(trimmed) || isBilingualLockup(trimmed);
  const text = designed ? splitPair(keepLetterSpacingTogether(trimmed)) : trimmed;
  const widestEm = designed
    ? Math.max(0, ...text.split(/[ \t\n]+/).map((part) => [...part].reduce((sum, ch) => sum + glyphWidth(ch), 0)))
    : 0;
  return { text, designed, widestEm: Math.round(widestEm * 100) / 100 };
}
