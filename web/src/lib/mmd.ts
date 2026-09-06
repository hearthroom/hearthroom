/**
 * 魅魔島（MMD）的「三件套」匯入：作者從原站拿到的是三個分開的檔，不是一張卡：
 *   - 正則匯出檔 `{ pageDepth, statusbar, beginning, regex_scripts[] }`，或「導出正則」的列表
 *     `[{ regex, content, name }]`（API 回包會再包一層 `{ code, data: [...] }`）
 *   - 世界書 JSON（酒館世界書檔的形狀；關鍵詞是 JSON 字串）
 *   - 角色設定 TXT（純文字，整份就是設定）
 *
 * 作者一次丟三個，這裡各認各的、拼成一份跟酒館卡同形的 ImportResult，表單就全預填好；
 * 少一兩個也行，缺的那部分留空給作者自己補。
 */

import { bookEntriesToDrafts, bookEntryDrops, countSplitEntries, ENTRY_CONTENT_MAX, worldInfoToBook, type DropNote, type ImportResult, type TavernBook } from "./tavern";
import { isMeimoRegexItem, loweredFromPageDepth, ruleSetFromImport, rulesFromMeimoList, type RegexRuleSet } from "./regex-rules";
import { makeDraft } from "./role-draft";

export type MmdPart = "rules" | "book" | "definition";
export const MMD_PARTS: MmdPart[] = ["rules", "book", "definition"];

/** 一個檔案認出來是哪一部分，連同它帶的東西。 */
export type MmdFile =
  | { part: "rules"; fileName: string; set: RegexRuleSet; welcome: string; roleName: string }
  | { part: "book"; fileName: string; book: TavernBook }
  | { part: "definition"; fileName: string; text: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** 檔名去掉副檔名，當找不到名字時的角色名。 */
export function stemOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

/**
 * 認一個檔。認不得就丟 Error，訊息是錯誤碼：`mmd_empty` / `mmd_invalid_json` / `mmd_unknown`。
 * 純文字只有在「看起來不像壞掉的 JSON」時才當設定——以 { 或 [ 開頭卻解析失敗的多半是檔壞了。
 */
export function classifyMmdFile(fileName: string, content: string): MmdFile {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) throw new Error("mmd_empty");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    if (/^[[{]/.test(trimmed)) throw new Error("mmd_invalid_json");
    return { part: "definition", fileName, text: trimmed };
  }
  if (typeof raw === "string") {
    // 整份是一個 JSON 字串：當設定文字
    if (!raw.trim()) throw new Error("mmd_empty");
    return { part: "definition", fileName, text: raw.trim() };
  }
  if (!raw || typeof raw !== "object") throw new Error("mmd_unknown");
  const obj = raw as Record<string, unknown>;

  // 「導出正則」列表，或 API 回包 { code, data: [...] }
  const list = Array.isArray(raw) ? raw : Array.isArray(obj.data) ? obj.data : null;
  if (list && list.length && list.every(isMeimoRegexItem)) {
    const set: RegexRuleSet = { version: 1, rules: rulesFromMeimoList(list), statusbar: "", lowered: false };
    if (!set.rules.length) throw new Error("mmd_empty");
    return { part: "rules", fileName, set, welcome: "", roleName: "" };
  }

  // 世界書（酒館世界書檔，或一張卡裡的 book）
  const book = worldInfoToBook(raw);
  if (book) {
    if (!(book.entries ?? []).length) throw new Error("mmd_empty");
    return { part: "book", fileName, book };
  }

  // 正則匯出檔 / 裸的酒館規則陣列 / 匯入酬載
  const imported = ruleSetFromImport(raw);
  if (imported) {
    if (!Array.isArray(raw) && "pageDepth" in obj) imported.set.lowered = loweredFromPageDepth(obj.pageDepth);
    return { part: "rules", fileName, set: imported.set, welcome: imported.welcome, roleName: str(obj.roleName) || str(obj.name) };
  }
  throw new Error("mmd_unknown");
}

export interface MmdImportResult extends ImportResult {
  spec: "mmd";
  /** 三部分各自到位了沒。畫面用它畫清單。 */
  parts: Record<MmdPart, boolean>;
}

/** 把認好的檔拼成一份匯入結果。同一部分有多個時取最後一個（畫面已經先擋掉了）。 */
export function mergeMmdFiles(files: MmdFile[], options: { language: string }): MmdImportResult {
  const rules = files.filter((f): f is Extract<MmdFile, { part: "rules" }> => f.part === "rules").at(-1) ?? null;
  const book = files.filter((f): f is Extract<MmdFile, { part: "book" }> => f.part === "book").at(-1) ?? null;
  const definition = files.filter((f): f is Extract<MmdFile, { part: "definition" }> => f.part === "definition").at(-1) ?? null;

  const draft = makeDraft(options.language);
  // 名字：匯出檔裡帶的 > 設定檔的檔名 > 世界書名 > 任一檔的檔名
  draft.roleName =
    rules?.roleName ||
    (definition ? stemOf(definition.fileName) : "") ||
    str(book?.book.name) ||
    (files[0] ? stemOf(files[0].fileName) : "");
  draft.roleDetailDesc = definition?.text ?? "";
  // 整卡匯入：開場白直接用匯出檔的 beginning，不看表單裡原本有沒有
  draft.roleWelcome = rules?.welcome ?? "";

  const dropped: DropNote[] = [];
  let worldbook: ImportResult["worldbook"] = null;
  if (book) {
    const entries = book.book.entries ?? [];
    worldbook = { name: str(book.book.name) || draft.roleName, description: str(book.book.description), format: "tavern", entries: bookEntriesToDrafts(entries) };
    dropped.push(...bookEntryDrops(entries));
    const split = countSplitEntries(entries);
    if (split) dropped.push({ key: "import.split.entries", params: { n: split, max: ENTRY_CONTENT_MAX } });
  }

  return {
    draft,
    worldbook,
    dropped,
    image: null,
    spec: "mmd",
    regex: rules?.set ?? null,
    parts: { rules: !!rules, book: !!book, definition: !!definition },
  };
}
