import { TO_HANS } from "./originality-hans";
import { JP_TO_HANT } from "./search-jp";
import { ALIAS_GROUPS } from "./search-aliases";

/** 一個字的正規形：日文新字體→繁體→簡體。 */
const canon = (ch: string): string => {
  const hant = JP_TO_HANT.get(ch) ?? ch;
  return TO_HANS.get(hant) ?? hant;
};

/**
 * 搜尋用的正規化：全半形統一（NFKC）、日文新字體與繁體逐字轉簡體、英文小寫、標點與符號去掉。
 * 索引（search_name／search_text／search_body）與查詢字串都先過這一層再比，所以
 * 「萬族創世錄」「万族创世录」「末日·進化」「末日進化」「ＳＡＯ」「sao」各自都找得到對方。
 * 空白留著：它分隔英文單字，也是查詢拆詞的依據。「我的卡片」的搜尋也用這一個。
 */
export const searchForm = (text: string): string =>
  [...text.normalize("NFKC")]
    .map(canon)
    .join("")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/g, " ")
    // 中日文沒有詞間空白，名字裡的空白（「問道錄 凡塵篇」）只是排版：去掉，連著打也找得到
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "")
    .trim();

/** 把查詢字串拆成一個個詞：先按空白（含全形）分，再各自正規化；空的不算。先分再正規化，中文詞之間的空白才保得住。 */
export function searchTerms(q: string): string[] {
  return q.split(/[\s\u3000]+/).map(searchForm).filter(Boolean);
}

/** 別名表的正規形，載入時算一次。 */
const aliasOf = new Map<string, string[]>();
for (const group of ALIAS_GROUPS) {
  const forms = [...new Set(group.map(searchForm).filter(Boolean))];
  for (const f of forms) aliasOf.set(f, forms);
}

/** 一個詞的所有寫法：整個詞就是某個別名時展開成那一組，否則就是它自己。 */
export const expandTerm = (term: string): string[] => aliasOf.get(term) ?? [term];

/** 同一組異體字：正規形與所有對到它的繁體、日文字。建一次就好。 */
let variantGroups: Map<string, string[]> | null = null;
function variantsOf(ch: string): string[] {
  if (!variantGroups) {
    const byCanon = new Map<string, Set<string>>();
    const add = (c: string) => {
      const key = canon(c);
      let group = byCanon.get(key);
      if (!group) byCanon.set(key, (group = new Set([key])));
      group.add(c);
    };
    for (const hant of TO_HANS.keys()) add(hant);
    for (const jp of JP_TO_HANT.keys()) add(jp);
    variantGroups = new Map();
    for (const group of byCanon.values()) for (const c of group) variantGroups.set(c, [...group]);
  }
  return variantGroups.get(ch) ?? [ch];
}

/**
 * 給沒有正規化欄位的地方（標籤名、作者名）用的 GLOB 樣式：每個字展開成它的異體類別、
 * 英文展開成大小寫類別，其餘照字面。例：`轻舟` → `*[轻輕][舟]*`、`Luna` → `*[lL][uU][nN][aA]*`。
 * GLOB 的特殊字元（* ? [）放進中括號就是字面值。
 */
export function hanziGlob(term: string): string {
  const parts = [...term.normalize("NFKC")].map((ch) => {
    if (ch === "]" || ch === "-" || ch === "^") return ch;
    const set = new Set<string>([...variantsOf(ch), ch.toLowerCase(), ch.toUpperCase()]);
    for (const c of [...set]) if (c === "]" || c === "-" || c === "^") set.delete(c);
    return `[${[...set].join("")}]`;
  });
  return `*${parts.join("")}*`;
}
