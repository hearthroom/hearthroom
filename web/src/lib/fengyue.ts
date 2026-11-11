/**
 * AI 風月（fyue.app）「導出配置」檔的匯入。
 *
 * 風月的匯出是一份平的 JSON，最大的坑是**頂層鍵名每次匯出都從別名池隨機挑**：同一張卡連續匯出
 * 11 次，標題鍵出現過 title／ttl／name／nm／app_name（2026-11-09 用測試卡實測，樣本在
 * docs/studio/tasks/2026-11-09-aifengyue-compat-research/）。陣列裡的物件（世界書條目、正則、快捷指令）
 * 鍵名固定。別名表在 fengyue-format.json，跟 CLI 的 internal/importer/fengyue-format.json 是同一份，
 * 用例檔 test/fixtures/fengyue-cases.json 也是；改一邊就兩邊一起改。
 *
 * 判定排在酒館 V1 之前：標題鍵剛好抽到 `name` 的那幾份，以前會被當成平鋪的酒館卡，只匯入名稱、
 * 其餘靜默丟光。依據是多個欄位別名同時命中，加上變量面板那組 `ai_v`／`ai_variable` 開頭的鍵
 * （實測每份都有），不靠任何單一鍵。
 *
 * 欄位怎麼落：
 *   - 提示詞 → 角色設定、前置詞 → 輸出規範、後置詞 → 進階指令、簡介 → 簡介、作品名 → 角色名
 *   - 開場白選項（玩家點的第一句話，不是 AI 先說的開場）→ 本站的開場選項 prologue；作品用「預設對話」模式時
 *     改取每組預設對話裡那句，問答本身先列進摘要
 *   - 世界書 → 一本酒館格式的書；`value` 是內容，`key` 去掉 `_or_` 前綴
 *   - 內置 CSS → 作者資產的 cardCss，整卡只套用一次
 *   - 正則腳本 → 顯示規則
 *   - 詳細介紹 → 作者資產的首屏網頁 openingPage（畫布最上方的作者網頁，只顯示、不送模型）；卡片格式記成 fengyue
 *   - 變量面板：資料骨架 → 卡片變數（plain 寫法）、變量提示詞 → 變數規則、面板皮膚 → 面板皮膚
 * 只有實測過的值才照映射（世界書 key_region、正則 scope），其餘退回預設並列進摘要。
 */

import contract from "./fengyue-format.json";
import { bookEntriesToDrafts, countSplitEntries, entryContentMax, type DropNote, type ImportResult, type TavernBookEntry } from "./tavern";
import { fallbackLimits, makeDraft } from "./role-draft";
import { formatJson, type CardStateDraft } from "./card-state";
import type { RegexMessageTarget, RegexRule, RegexRuleSet } from "./regex-rules";

type Field = keyof typeof contract.fields;
type Raw = Record<string, unknown>;

export const FENGYUE_CSS_RULE_ID = "hearthroom-fengyue-inner-css";

export interface FengyueImportResult extends ImportResult {
  spec: "fengyue";
  /** 詳細介紹：作者寫給玩家看的首屏網頁（HTML／CSS／腳本），不送給模型。 */
  intro: string;
}

const aliasOf = new Map<string, Field>();
for (const [field, aliases] of Object.entries(contract.fields) as [Field, string[]][]) {
  for (const alias of aliases) aliasOf.set(alias, field);
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);

/** 依別名表取欄位。同一個欄位出現兩個別名時取第一個有內容的。 */
function pick(raw: Raw, field: Field): unknown {
  let fallback: unknown;
  for (const alias of contract.fields[field]) {
    if (!(alias in raw)) continue;
    const value = raw[alias];
    if (value !== "" && value != null && !(Array.isArray(value) && !value.length)) return value;
    fallback ??= value;
  }
  return fallback;
}

const isSignalKey = (key: string): boolean => contract.detect.signalKeyPrefixes.some((p) => key.startsWith(p));

/** 這份 JSON 是不是風月的匯出檔。看鍵有沒有出現，不看值：匯出檔連空欄位也會寫出來。 */
export function isFengyueExport(raw: unknown): raw is Raw {
  if (!isObj(raw)) return false;
  const keys = Object.keys(raw);
  if (!keys.some(isSignalKey)) return false;
  const fields = new Set(keys.map((k) => aliasOf.get(k)).filter(Boolean));
  if (fields.size < contract.detect.minFields) return false;
  const book = pick(raw, "worldbook");
  if (Array.isArray(book) && book.length) {
    const first = book[0];
    if (!isObj(first) || !contract.detect.worldbookEntryKeys.every((k) => k in first)) return false;
  }
  return true;
}

/** 風月的正則沒有分隔符，替換語法跟 JS 相同（$1）。包成本站的 `/pattern/flags`，未跳脫的 / 補跳脫。 */
export function regexFind(pattern: string): string {
  let out = "";
  let escaped = false;
  for (const ch of pattern) {
    if (ch === "/" && !escaped) out += "\\/";
    else out += ch;
    escaped = ch === "\\" && !escaped;
  }
  return `/${out}/${contract.regex.flags}`;
}

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const countWhere = <T>(rows: T[], test: (row: T) => boolean): number => rows.filter(test).length;

function convertBook(rows: Raw[], notes: DropNote[]): TavernBookEntry[] {
  const prefix = contract.worldbook.keyPrefix;
  const sep = contract.worldbook.keySeparator;
  const regions = contract.worldbook.triggerRegion as Record<string, string>;
  const isOrKey = (r: Raw) => str(r.key).startsWith(prefix) && (r.match_type === undefined || Number(r.match_type) === 2);
  const n = {
    region: countWhere(rows, (r) => !(String(r.key_region) in regions)),
    position: countWhere(rows, (r) => r.value_region !== undefined && Number(r.value_region) !== contract.worldbook.defaultValueRegion),
    probability: countWhere(rows, (r) => r.probability !== undefined && Number(r.probability) !== contract.worldbook.defaultProbability),
    keyFormat: countWhere(rows, (r) => !isOrKey(r)),
    group: countWhere(rows, (r) => !!str(r.group)),
  };
  if (n.region) notes.push({ key: "import.fengyue.entryRegion", params: { n: n.region } });
  if (n.position) notes.push({ key: "import.fengyue.entryPosition", params: { n: n.position } });
  if (n.probability) notes.push({ key: "import.fengyue.entryProbability", params: { n: n.probability } });
  if (n.keyFormat) notes.push({ key: "import.fengyue.entryKeyFormat", params: { n: n.keyFormat } });
  if (n.group) notes.push({ key: "import.fengyue.entryGroup", params: { n: n.group } });
  return rows.map((r) => {
    const key = str(r.key);
    // 只有 `_or_`（任一關鍵詞，風月用 @wb@ 分隔）能拆成多關鍵詞；其他前綴原樣留著，作者看得到也改得了，已列進摘要
    const keys = isOrKey(r)
      ? key.slice(prefix.length).split(sep).flatMap((part) => part.split(/[,，]/)).map((k) => k.trim()).filter(Boolean)
      : key ? [key] : [];
    const depth = Number(r.depth);
    return {
      keys,
      content: str(r.value),
      enabled: r.enable !== false,
      insertion_order: Number.isInteger(Number(r.sort)) ? Number(r.sort) : 0,
      ...(Number.isInteger(depth) && depth > 0 && depth <= 100 ? { scan_depth: depth } : {}),
      extensions: { fengyue: { triggerRegion: regions[String(r.key_region)] ?? "" } },
    };
  });
}

function convertRegex(rows: Raw[], notes: DropNote[]): RegexRule[] {
  const scopes = contract.regex.targets as Record<string, RegexMessageTarget[]>;
  const unknownScope = countWhere(rows, (r) => !(String(r.scope) in scopes));
  const rewritesHistory = countWhere(rows, (r) => r.is_only_render === false);
  if (unknownScope) notes.push({ key: "import.fengyue.regexScope", params: { n: unknownScope } });
  if (rewritesHistory) notes.push({ key: "import.fengyue.regexHistory", params: { n: rewritesHistory } });
  return rows
    .filter((r) => str(r.match_regex))
    .map((r, i) => ({
      id: `fengyue-${i + 1}`,
      name: [...(str(r.title) || `#${i + 1}`)].slice(0, 40).join(""),
      find: regexFind(String(r.match_regex)),
      replace: typeof r.replace_text === "string" ? r.replace_text : "",
      enabled: r.is_enable !== false,
      ...(scopes[String(r.scope)] ? { targets: [...scopes[String(r.scope)]] } : {}),
    }));
}

/** 沒有對應的功能：每一項都要出現在摘要裡。 */
function unmappedFeatures(raw: Raw, notes: DropNote[]) {
  const shortcuts = listOf(pick(raw, "shortcuts")).length;
  if (shortcuts) notes.push({ key: "import.fengyue.shortcuts", params: { n: shortcuts } });
  const banned = listOf(pick(raw, "bannedWords")).filter((w) => str(w)).length;
  if (banned) notes.push({ key: "import.fengyue.bannedWords", params: { n: banned } });
  // 變量面板認得的三欄（骨架、提示詞、皮膚）在 convertVariables 處理；這裡只管別名表沒收的變量鍵
  if (Object.entries(raw).some(([k, v]) => isSignalKey(k) && !aliasOf.has(k) && !!str(v))) notes.push({ key: "import.fengyue.variablesUnknown" });

  // 匯出檔每個欄位都會寫出鍵（空的也寫）；一個別名都沒出現，就是風月換了我們沒收到的名字
  const missing = (Object.keys(contract.fields) as Field[]).filter((f) => !contract.fields[f].some((alias) => alias in raw)).length;
  if (missing) notes.push({ key: "import.fengyue.missingFields", params: { n: missing } });

  // 其餘鍵沒量到別名，靠形狀認：自定義總結、背景音樂；剩下有實質內容的一起算
  let other = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (aliasOf.has(key) || isSignalKey(key)) continue;
    if (isObj(value) && (str(value.big_prompt) || str(value.small_prompt))) {
      notes.push({ key: "import.fengyue.summaryConfig" });
    } else if (isObj(value) && Array.isArray(value.tracks)) {
      if (value.tracks.length) notes.push({ key: "import.fengyue.music", params: { n: value.tracks.length } });
    } else if (hasContent(value)) other++;
  }
  if (other) notes.push({ key: "import.fengyue.otherFields", params: { n: other } });
}

/**
 * 變量面板 → 卡片變數。風月的骨架是一段 JSON 字串（只有值，沒有逐值規則），所以用 plain 寫法；
 * 變量提示詞是寫給模型的更新規則，進規則欄；面板皮膚（Handlebars）原樣帶過去。
 * 骨架是空字串＝作者沒用變量面板（編輯頁預填的範本沒改就不會存）：這時只有提示詞也不開，
 * 提示詞原文列進摘要，作者要的話自己補骨架。骨架解不開時照原文放進去，編輯器會標出錯在哪。
 */
function convertVariables(raw: Raw, notes: DropNote[]): CardStateDraft | null {
  const rawSkeleton = pick(raw, "variableSkeleton");
  const skeleton = isObj(rawSkeleton) ? formatJson(rawSkeleton) : str(rawSkeleton);
  const prompt = str(pick(raw, "variablePrompt"));
  const template = typeof pick(raw, "variableTemplate") === "string" ? String(pick(raw, "variableTemplate")).trim() : "";
  if (!skeleton) {
    if (prompt) notes.push({ key: "import.fengyue.variablesPromptOnly", params: { text: prompt } });
    if (template) notes.push({ key: "import.fengyue.variablesTemplateOnly" });
    return null;
  }
  let dataText = skeleton;
  try {
    const parsed: unknown = JSON.parse(skeleton);
    if (!isObj(parsed)) throw new Error("not_object");
    dataText = formatJson(parsed);
    notes.push({ key: "import.fengyue.variablesConverted" });
  } catch {
    notes.push({ key: "import.fengyue.variablesPartial" });
  }
  return { convention: "plain", dataText, rulesText: prompt, template };
}

/** 平台設定（開關、數字、短代碼）不算內容；陣列、網址、長字串才算。 */
function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) || [...value.trim()].length > 30 || value.includes("\n");
  return false;
}

export function fengyueToDraft(raw: Raw, options: { language: string; limits?: Record<string, number> }): FengyueImportResult {
  const { language } = options;
  const notes: DropNote[] = [];
  const draft = makeDraft(language);
  draft.roleName = str(pick(raw, "name"));
  draft.roleDesc = str(pick(raw, "summary"));
  draft.roleDetailDesc = str(pick(raw, "prompt"));
  draft.roleOutputContract = str(pick(raw, "prefix"));
  draft.jailbreak = str(pick(raw, "suffix"));

  // 風月的「對話方式」二選一，兩種都是玩家點一句當自己的第一句話（AI 不先說話）：
  // 開場白模式點的是 openings；預設對話模式點的是每組預設對話裡的那句，另外還有一段先演給玩家看的問答
  const presets = listOf(pick(raw, "presetChats")).filter(isObj);
  const choiceList = listOf(pick(raw, "openings")).map(str).filter(Boolean);
  // 模式鍵若用了別名表沒收的名字，就看哪一份清單有內容；兩份都有時不猜哪一份玩家看得到
  const modeValue = Number(pick(raw, "openingMode"));
  const mode = modeValue === contract.openingMode.presetChats ? "presets"
    : modeValue === contract.openingMode.openings ? "openings"
    : presets.length && !choiceList.length ? "presets"
    : choiceList.length && !presets.length ? "openings"
    : presets.length ? "unknown" : "openings";
  const openings = mode === "presets" ? presets.flatMap((p) => listOf(p.suggested_questions).map(str).filter(Boolean)) : choiceList;
  if (mode === "presets") {
    if (presets.length) notes.push({ key: "import.fengyue.presetChats", params: { n: presets.length } });
    if (choiceList.length) notes.push({ key: "import.fengyue.unusedOpenings", params: { n: choiceList.length } });
  } else if (mode === "unknown") {
    notes.push({ key: "import.fengyue.openingModeUnknown", params: { n: presets.length } });
  } else if (presets.length) {
    notes.push({ key: "import.fengyue.unusedPresets", params: { n: presets.length } });
  }
  const max = contract.limits.openings;
  draft.prologue = openings.slice(0, max);
  if (openings.length > max) notes.push({ key: "import.fengyue.prologueLimit", params: { n: openings.length - max, max } });

  const limits = options.limits ?? fallbackLimits(language);
  const sized: [string, keyof typeof draft, string][] = [
    ["name", "roleName", "roleName"],
    ["summary", "roleDesc", "roleDesc"],
    ["definition", "roleDetailDesc", "roleDetailDesc"],
    ["outputContract", "roleOutputContract", "roleOutputContract"],
    ["custom", "jailbreak", "jailbreak"],
  ];
  // 超過上限的整段留著：截斷會讓作者不知道少了哪裡，留著的話表單會標紅，作者自己決定刪哪段
  for (const [label, field, limitKey] of sized) {
    const n = [...String(draft[field])].length;
    const cap = limits[limitKey];
    if (cap && n > cap) notes.push({ key: `import.fengyue.tooLong.${label}`, params: { n, max: cap } });
  }

  const intro = typeof pick(raw, "intro") === "string" ? String(pick(raw, "intro")).trim() : "";
  // 風月沒有 AI 先說的開場白：有開場選項或首屏網頁時本站也讓玩家先開口；兩樣都沒有才要作者補一段
  if (!intro && !draft.prologue.length) notes.push({ key: "import.fengyue.noWelcome" });

  let worldbook: ImportResult["worldbook"] = null;
  const bookRows = listOf(pick(raw, "worldbook")).filter(isObj);
  if (bookRows.length) {
    const entries = convertBook(bookRows, notes);
    // 觸發範圍借 extensions 帶過拆條（拆開的條目要跟原條目同一個範圍），落地前拿掉
    const drafts = bookEntriesToDrafts(entries, undefined, language).map(({ matchOptions, ...entry }) => {
      const { extensions, ...options } = matchOptions!;
      const { fengyue, ...rest } = extensions ?? {};
      return {
        ...entry,
        triggerRegion: isObj(fengyue) ? str(fengyue.triggerRegion) : "",
        matchOptions: Object.keys(rest).length ? { ...options, extensions: rest } : options,
      };
    });
    worldbook = { name: draft.roleName, description: "", format: "tavern", entries: drafts };
    const split = countSplitEntries(entries, language);
    if (split) notes.push({ key: "import.split.entries", params: { n: split, max: entryContentMax(language) } });
  }

  const rules = convertRegex(listOf(pick(raw, "regex")).filter(isObj), notes);
  // CSS 是作者原文，前後空白與換行也要保留；不能照一般文字欄位 trim。
  const css = typeof pick(raw, "css") === "string" ? String(pick(raw, "css")) : "";
  const regex: RegexRuleSet | null = rules.length || intro || css
    ? { version: 1, rules, statusbar: "", lowered: false, pageMode: "sandbox", format: "fengyue", ...(intro ? { openingPage: intro } : {}), ...(css ? { cardCss: css, cardCssDialect: "fengyue" } : {}) }
    : null;

  draft.state = convertVariables(raw, notes);
  unmappedFeatures(raw, notes);
  return { draft, worldbook, dropped: notes, image: null, background: null, spec: "fengyue", regex, intro };
}

/** 從檔案讀風月匯出檔；不是 JSON 或不是風月的格式就回 null，讓呼叫端照原本的路走。 */
export async function readFengyueFile(file: File): Promise<Raw | null> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const start = new TextDecoder().decode(head).replace(/^﻿/, "").trimStart();
  if (!start.startsWith("{")) return null;
  try {
    const raw: unknown = JSON.parse((await file.text()).replace(/^﻿/, ""));
    return isFengyueExport(raw) ? raw : null;
  } catch {
    return null;
  }
}
