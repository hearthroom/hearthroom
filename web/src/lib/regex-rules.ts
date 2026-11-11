/**
 * 正則規則：作者替選定訊息寫的一組「找到 → 換成」。
 *
 * 用途是把 AI 吐出的標記（『台詞』、<status>…</status>、《美1》這類佔位）在畫面上換成有樣式、
 * 有互動的 HTML。這是酒館與同類站台共有的玩法，資料形狀也跟它們對齊，卡片才搬得動：
 *   - 酒館：`extensions.regex_scripts[]`，欄位 scriptName / findRegex / replaceString / disabled
 *   - 魅魔島匯出：`{ pageDepth, statusbar, beginning, regex_scripts[] }`，條目只有 id / scriptName / findRegex / replaceString
 *
 * `find` 有兩種寫法：`/pattern/flags` 是正則（JS 語法，替換裡的 $1 原樣可用）；不是這個形狀就是
 * 字面字串，全部出現處都換。樣例資料 38 條裡 33 條是字面標記，這不是邊角情況。
 *
 * 規則在**看的人**的瀏覽器裡跑：對話頁把選定種類的訊息先過一遍規則再渲染。替換內容裡的 script / style
 * 會執行——這跟本站「AI 生成的 HTML 卡」是同一個信任模型，不是漏洞。
 */

export type RegexMessageTarget = "ai" | "user" | "system";
export const MESSAGE_TARGETS: RegexMessageTarget[] = ["ai", "user", "system"];

/** Missing targets preserves legacy all-message behavior; [] selects no messages. */
export const ruleTargets = (rule: Pick<RegexRule, "targets">): RegexMessageTarget[] => rule.targets ?? MESSAGE_TARGETS;

/**
 * 規則裡 <style> 的寫法：風月、酒館、MMD／本站。沒填照卡片格式。畫布照它解讀這段 CSS
 * （風月寫法會轉到我們的介面元素，並排在作者其他樣式之下），所以同一張卡可以混用不同寫法的規則。
 */
export const CSS_DIALECTS = ["fengyue", "tavern", "mmd"] as const;
export type CssDialect = (typeof CSS_DIALECTS)[number];
/** 風月匯入器產生的內置 CSS 規則 id（fengyue.ts 的 FENGYUE_CSS_RULE_ID，畫布同一個值）。 */
const LEGACY_FENGYUE_CSS_RULE_ID = "hearthroom-fengyue-inner-css";
export const cssDialectFrom = (v: unknown): CssDialect | undefined => (CSS_DIALECTS as readonly string[]).includes(String(v)) ? (v as CssDialect) : undefined;

export interface RegexRule {
  id: string;
  name: string;
  /** `/pattern/flags` 或字面字串。 */
  find: string;
  replace: string;
  enabled: boolean;
  targets?: RegexMessageTarget[];
  cssDialect?: CssDialect;
}

export interface RegexRuleSet {
  version: 1;
  rules: RegexRule[];
  /**
   * 功能欄：對話頁最上層的一個固定區塊，只在看的人畫面上顯示、不進 AI 的上下文。
   * 內容一樣過規則，多半是一排佔位標記（《美1》《狀1》…），由規則展開成全局樣式與側邊工具。
   * 魅魔島的作法相同：整頁只渲染一次，不是接在訊息後面。
   */
  statusbar: string;
  /** 降低層級：勾了就放到輸入框之下（預設在頁面最上層）。對應魅魔島的 pageDepth、上游的 mountLayer=under。 */
  lowered: boolean;
  /** 上游還有第三層 cover（蓋整個畫面）；本站編輯器不提供，但讀到了要原樣存回去。 */
  mountLayer?: "cover";
  /**
   * 頁面模式。缺＝舊版聊天頁（規則直接套在畫面上）。`sandbox`＝新版沙箱：整個聊天區交給
   * 作者的殼在獨立 iframe 裡渲染，對應魅魔島匯出檔的 `chatVersion: 1`。`immersive` 是上游另一種
   * 舊頁版面（滿版乾淨畫布），本站編輯器不提供，讀到了原樣帶著走。
   */
  pageMode?: RegexPageMode;
  /**
   * 卡片格式：這套規則裡的 <style> 是用哪一邊的寫法寫的。缺＝MMD（樣式原樣套整頁，作者就是靠它換
   * 背景與輸入框）。`tavern`＝酒館寫法：原平台會替每條選擇器逐字接上訊息層前綴，`body{}` 這種在那邊從來
   * 沒生效過；聊天頁照同一套政策落地，卡在兩邊才長得一樣。由匯入來源宣告，讀的人不猜。
   */
  format?: RegexCardFormat;
  /**
   * 首屏網頁（AI 風月的「詳細介紹」）：開新對話時畫布最上方的作者網頁，只顯示、不送模型。
   * 跟規則一起存在作者資產裡；空字串或缺＝沒有。
   */
  openingPage?: string;
  /** 整卡只套用一次的作者 CSS；缺欄位保留舊上游資料，空字串清除。 */
  cardCss?: string;
  /** 匯入／舊資料的相容提示；作者不用選。 */
  cardCssDialect?: CssDialect;
  /**
   * 開局呈現：作者在編輯頁選的「開場白」（greeting）或「開場網頁」（page）。畫布看它決定點開場選項
   * 是填進輸入框還是直接送出；缺＝還沒讀到上游的值，照卡片格式判斷（見 openingModeOf）。
   */
  openingMode?: OpeningMode;
}

/** 開局呈現：greeting＝開場白開啟對話；page＝玩家從開場網頁與選項開局（點了直接送出）。 */
export type OpeningMode = "greeting" | "page";

export function openingModeFrom(v: unknown): OpeningMode | undefined {
  return v === "greeting" || v === "page" ? v : undefined;
}

/**
 * 這張卡現在的開局呈現。上游讀回來一定有值；沒讀過（新卡、舊上游）時照卡片格式：
 * AI 風月匯入的卡一直是點選項直接送出，算開場網頁，其他卡算開場白（owner 2026-11-10，既有卡行為不變）。
 */
export function openingModeOf(set: Pick<RegexRuleSet, "openingMode" | "format">): OpeningMode {
  return set.openingMode ?? (set.format === "fengyue" ? "page" : "greeting");
}

/** `fengyue`＝AI 風月匯入的卡：樣式整頁生效、深淺跟著宿主。點開場選項的行為看開局呈現，不看格式。 */
export type RegexCardFormat = "mmd" | "tavern" | "fengyue";
export function cardFormatFrom(v: unknown): RegexCardFormat | undefined {
  const value = typeof v === "string" ? v.trim().toLowerCase() : "";
  return value === "mmd" || value === "tavern" || value === "fengyue" ? value : undefined;
}

export type RegexPageMode = "classic" | "immersive" | "sandbox";

/** 編輯器給作者選的聊天頁版本：舊版（規則套在畫面上）或新版沙箱。immersive 不在選單裡。 */
export type ChatPageChoice = "classic" | "sandbox";

export function chatPageOf(set: Pick<RegexRuleSet, "pageMode">): ChatPageChoice {
  return set.pageMode === "sandbox" ? "sandbox" : "classic";
}

/** 認上游／檔案裡的 pageMode 字串；認不得的當沒寫。 */
export function pageModeFrom(v: unknown): RegexPageMode | undefined {
  const s = text(v);
  return s === "classic" || s === "immersive" || s === "sandbox" ? s : undefined;
}

/** 魅魔島匯出檔的 `chatVersion`：1（數字或字串）是新版沙箱卡，其他值或缺欄位都是舊版。 */
export function isSandboxChatVersion(v: unknown): boolean {
  return String(v ?? "").trim() === "1";
}

/**
 * 上限對齊上游作者資產：單條替換 512 KB、整份 32 MB，都以 UTF-8 位元組計。
 * 單條之前寫成 32 KB，比上游嚴：圖片集那種一條塞十幾張圖的規則會在這裡被擋，作者只好拔掉，
 * 功能欄裡的觸發字串就原樣印在畫面上（2026-09-07 一張卡的「[圖片集02]」就是這樣）。
 * 整份之前是 1 MB：2026-09-11 一位作者匯入 66 條、1.18 MB 的規則檔，讀進來了卻存不了，
 * 畫面上只有「完成」按鈕變灰，什麼都沒說——整份的問題沒有掛在任何一條規則上，編輯器只畫
 * 逐條的提示。現在上游放寬到 32 MB，整份的問題也在標題列講出來（多大、上限多少）。
 */
export const REGEX_LIMITS = {
  /** 編輯器容量；大小限制仍分別套用，匯入不截斷超量規則。 */
  rules: 1000,
  name: 40,
  find: 1000,
  /** 單條替換內容（位元組）。 */
  replaceBytes: 512 * 1024,
  /** 大型替換的非阻擋提醒門檻（UTF-8 bytes）。 */
  replaceWarningBytes: 256 * 1024,
  statusbar: 4000,
  /** 整份規則的上限（位元組）：每條 id+name+find+replace 加總，跟上游同一把尺。 */
  total: 32 * 1024 * 1024,
} as const;

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * 整份規則多大，算法跟上游一模一樣：每條 id、name、find、replace 的 UTF-8 位元組加總。
 * 之前量的是整份 JSON 的長度，比上游多算了鍵名與跳脫字元——這裡說太大而上游其實收得下，
 * 或反過來，都會讓作者摸不著頭緒。同一把尺，這裡放行的上游就收。
 */
export const ruleSetBytes = (set: RegexRuleSet): number =>
  set.rules.reduce((n, r) => n + ruleBytes(r), 0);

export const ruleBytes = (rule: RegexRule): number =>
  utf8Bytes(rule.id) + utf8Bytes(rule.name) + utf8Bytes(rule.find) + utf8Bytes(rule.replace);

/** 給人看的 MB：小於 10 MB 留一位小數（1.2 MB），再大就取整。 */
export const formatMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1);

export const emptyRuleSet = (): RegexRuleSet => ({ version: 1, rules: [], statusbar: "", lowered: false });

export const newRuleId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const makeRule = (partial: Partial<RegexRule> = {}): RegexRule => ({
  id: newRuleId(),
  name: "",
  find: "",
  replace: "",
  enabled: true,
  targets: ["ai"],
  ...partial,
});

const REGEX_LITERAL = /^\/([\s\S]+)\/([dgimsuvy]*)$/;

/**
 * 把 find 解成可用的東西。`/pat/flags` → RegExp；壞的正則回 Error（畫面要把它標出來，不能靜默跳過）；
 * 其他一律字面字串。
 */
export function parseFind(find: string): RegExp | string | Error {
  const match = REGEX_LITERAL.exec(find);
  if (!match) return find;
  try {
    return new RegExp(match[1], match[2]);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function replaceAllLiteral(text: string, needle: string, replacement: string): string {
  if (!needle) return text;
  return text.split(needle).join(replacement);
}

/** 依序套用啟用中的規則。壞規則跳過——一條寫錯不該讓整則回覆變空白。 */
export function applyRules(text: string, rules: RegexRule[], target?: RegexMessageTarget): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled || !rule.find || (target && !ruleTargets(rule).includes(target))) continue;
    const parsed = parseFind(rule.find);
    if (parsed instanceof Error) continue;
    out = typeof parsed === "string" ? replaceAllLiteral(out, parsed, rule.replace) : out.replace(parsed, rule.replace);
  }
  return out;
}

/** 套用一整組到一則 AI 回覆。 */
export function renderWithRules(text: string, set: RegexRuleSet): string {
  return applyRules(text, set.rules, "ai");
}

/** 功能欄展開後的 HTML；沒填就是空字串（畫面不渲染那一層）。 */
export function renderStatusbar(set: RegexRuleSet): string {
  return set.statusbar ? applyRules(set.statusbar, set.rules) : "";
}

/** 哪些規則有問題。key 是 i18n key，畫面翻譯。 */
export interface RuleIssue { ruleId: string; key: string; params?: Record<string, string | number> }
/** 提醒與拒收分開，匯入、套用及保存不因提醒而停下。 */
export function ruleSetWarnings(set: RegexRuleSet): RuleIssue[] {
  return set.rules.filter(rule => {
    const bytes = utf8Bytes(rule.replace);
    return bytes > REGEX_LIMITS.replaceWarningBytes && bytes <= REGEX_LIMITS.replaceBytes;
  }).map(rule => ({ ruleId: rule.id, key: "regex.warning.largeReplacement" }));
}

/** 單條檢查與整份檢查共用，讓編輯器只重算改動的那條。 */
export function validateRule(rule: RegexRule): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (!rule.find.trim()) issues.push({ ruleId: rule.id, key: "regex.issue.emptyFind" });
  if ([...rule.name].length > REGEX_LIMITS.name) issues.push({ ruleId: rule.id, key: "regex.issue.nameLong", params: { max: REGEX_LIMITS.name } });
  if ([...rule.find].length > REGEX_LIMITS.find) issues.push({ ruleId: rule.id, key: "regex.issue.findLong", params: { max: REGEX_LIMITS.find } });
  if (utf8Bytes(rule.replace) > REGEX_LIMITS.replaceBytes) issues.push({ ruleId: rule.id, key: "regex.issue.replaceLong", params: { max: REGEX_LIMITS.replaceBytes / 1024 } });
  if (parseFind(rule.find) instanceof Error) issues.push({ ruleId: rule.id, key: "regex.issue.badRegex" });
  return issues;
}

export function validateRuleSetLimits(set: RegexRuleSet, bytes: number): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (utf8Bytes(set.cardCss ?? "") > REGEX_LIMITS.replaceBytes) issues.push({ ruleId: "", key: "editor.cardCss.tooLong", params: { max: REGEX_LIMITS.replaceBytes / 1024 } });
  if (set.rules.length > REGEX_LIMITS.rules) issues.push({ ruleId: "", key: "regex.issue.tooMany", params: { max: REGEX_LIMITS.rules } });
  if ([...set.statusbar].length > REGEX_LIMITS.statusbar) issues.push({ ruleId: "", key: "regex.issue.statusbarLong", params: { max: REGEX_LIMITS.statusbar } });
  if (bytes > REGEX_LIMITS.total) issues.push({ ruleId: "", key: "regex.issue.totalLong", params: { size: formatMB(bytes), max: REGEX_LIMITS.total / 1024 / 1024 } });
  return issues;
}

export function validateRuleSet(set: RegexRuleSet): RuleIssue[] {
  const limits = validateRuleSetLimits(set, ruleSetBytes(set));
  // Keep the existing order: count, individual rules, then statusbar/size.
  return [
    ...limits.filter(issue => issue.key === "regex.issue.tooMany"),
    ...set.rules.flatMap(validateRule),
    ...limits.filter(issue => issue.key !== "regex.issue.tooMany"),
  ];
}

// ── 匯入 / 匯出 ─────────────────────────────────────────────────────────

/** 酒館的 regex_scripts 條目（與魅魔島匯出共用同一組欄位名）。 */
export interface TavernRegexScript {
  id?: unknown;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  promptOnly?: boolean;
  markdownOnly?: boolean;
  [key: string]: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** 酒館 placement: 1 = 玩家、2 = AI；缺欄位保留舊匯入行為。 */
function targetsFromTavern(script: TavernRegexScript): RegexMessageTarget[] | undefined {
  // Our exports carry targets as well, preserving system-only and empty selections.
  if (Array.isArray(script.targets)) return script.targets.filter((v): v is RegexMessageTarget => MESSAGE_TARGETS.includes(v as RegexMessageTarget));
  if (!Array.isArray(script.placement) || !script.placement.length) return undefined;
  const placement = script.placement.map(Number);
  return ([1, 2] as const).filter(p => placement.includes(p)).map(p => p === 1 ? "user" : "ai");
}

/** 提示詞端規則沒有顯示用途，略過並交匯入報告說明。markdownOnly留作顯示規則。 */
export function promptOnlyRuleCount(scripts: unknown): number {
  return Array.isArray(scripts) ? scripts.filter(s => s && typeof s === "object" && text(s.findRegex) && s.promptOnly === true).length : 0;
}

export function rulesFromTavern(scripts: unknown): RegexRule[] {
  if (!Array.isArray(scripts)) return [];
  return (scripts as TavernRegexScript[])
    .filter((s) => s && typeof s === "object" && text(s.findRegex))
    .filter((s) => s.promptOnly !== true)
    .filter((s) => Array.isArray(s.targets) || targetsFromTavern(s)?.length !== 0)
    .map((s, i) => {
      // 我們自己的匯出檔帶著 cssDialect；別家的檔沒有這個欄位。
      const cssDialect = cssDialectFrom(s.cssDialect);
      return makeRule({ name: text(s.scriptName) || `#${i + 1}`, find: text(s.findRegex), replace: text(s.replaceString), enabled: s.disabled !== true, targets: targetsFromTavern(s), ...(cssDialect ? { cssDialect } : {}) });
    });
}

/** 魅魔島自家「導出正則」列表（或 API 回包的 data）：條目是 { regex, content, name }。 */
export interface MeimoRegexItem {
  id?: unknown;
  name?: string;
  regex?: string;
  content?: string;
  [key: string]: unknown;
}

export const isMeimoRegexItem = (v: unknown): v is MeimoRegexItem =>
  !!v && typeof v === "object" && typeof (v as MeimoRegexItem).regex === "string" && ("content" in v || "name" in v);

export function rulesFromMeimoList(items: unknown): RegexRule[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(isMeimoRegexItem)
    .filter((it) => text(it.regex))
    .map((it, i) => makeRule({ name: text(it.name) || `#${i + 1}`, find: text(it.regex), replace: text(it.content), targets: undefined }));
}

export function rulesToTavern(rules: RegexRule[]): TavernRegexScript[] {
  return rules.map((r, i) => ({ id: i + 1, scriptName: r.name, findRegex: r.find, replaceString: r.replace, disabled: !r.enabled, ...(r.targets ? { targets: r.targets, placement: r.targets.filter(t => t !== "system").map(t => t === "user" ? 1 : 2) } : {}), ...(r.cssDialect ? { cssDialect: r.cssDialect } : {}) }));
}

/** 魅魔島的匯出檔。`beginning` 是第一句話（開場白），跟規則分開回給呼叫端決定要不要蓋。 */
export interface MeimoRegexFile {
  /** 1＝新版沙箱聊天頁；舊版檔沒有這個欄位。 */
  chatVersion?: number;
  pageDepth?: number;
  statusbar?: string;
  beginning?: string;
  regex_scripts?: TavernRegexScript[];
  cardCss?: string;
  cardCssDialect?: string;
}

/** 本站自己存的文件（lunatalk.regexRules.v1）讀回來。欄位缺的補預設，壞條目丟掉。 */
function ruleSetFromNative(obj: Record<string, unknown>): RegexRuleSet | null {
  if (!Array.isArray(obj.rules)) return null;
  const rules: RegexRule[] = (obj.rules as Partial<RegexRule>[])
    .filter((r) => r && typeof r === "object" && text(r.find))
    .map((r) => {
      // 這個欄位出現前匯入的風月內置 CSS（固定 id、沒標）畫布當風月寫法；編輯器照實顯示，存檔時補上。
      const cssDialect = cssDialectFrom(r.cssDialect) ?? (text(r.id) === LEGACY_FENGYUE_CSS_RULE_ID ? "fengyue" : undefined);
      return { id: text(r.id) || newRuleId(), name: text(r.name), find: text(r.find), replace: text(r.replace), enabled: r.enabled !== false, ...(Array.isArray(r.targets) ? { targets: r.targets.filter((v): v is RegexMessageTarget => MESSAGE_TARGETS.includes(v)) } : {}), ...(cssDialect ? { cssDialect } : {}) };
    });
  const set: RegexRuleSet = { version: 1, rules, statusbar: text(obj.statusbar), lowered: obj.lowered === true };
  const pageMode = pageModeFrom(obj.pageMode);
  if (pageMode) set.pageMode = pageMode;
  const format = cardFormatFrom(obj.cardFormat);
  if (format) set.format = format;
  return set;
}

export function ruleSetFromImport(raw: unknown): { set: RegexRuleSet; welcome: string; skippedPromptOnly?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // 自己存的形狀：rules 陣列直接讀，不需要走酒館欄位名的對映。
  // 魅魔島的「匯入酬載」也是 rules 陣列，旁邊多 statusbar / welcome / pageDepth。
  if (Array.isArray(obj.rules)) {
    const native = ruleSetFromNative(obj);
    if (!native) return null;
    migrateLegacyCardCss(native, obj as AuthorAssetLike);
    if (!native.rules.length && !native.cardCss) return null;
    if ("pageDepth" in obj) native.lowered = loweredFromPageDepth(obj.pageDepth);
    if (isSandboxChatVersion(obj.chatVersion)) native.pageMode = "sandbox";
    return { set: native, welcome: text(obj.welcome) };
  }
  // 三種來源：魅魔島檔、酒館卡（extensions.regex_scripts）、裸陣列
  let scripts: unknown = obj.regex_scripts;
  if (!scripts && obj.data && typeof obj.data === "object") scripts = (obj.data as { extensions?: { regex_scripts?: unknown } }).extensions?.regex_scripts;
  if (!scripts && Array.isArray(raw)) scripts = raw;
  const rules = rulesFromTavern(scripts);
  const skippedPromptOnly = promptOnlyRuleCount(scripts);
  if (!rules.length && !skippedPromptOnly && typeof obj.cardCss !== "string") return null;
  const set: RegexRuleSet = { version: 1, rules, statusbar: text(obj.statusbar), lowered: loweredFromPageDepth(obj.pageDepth) };
  migrateLegacyCardCss(set, obj as AuthorAssetLike);
  if (isSandboxChatVersion(obj.chatVersion)) set.pageMode = "sandbox";
  // 魅魔島的正則匯出檔也是酒館的欄位名（regex_scripts），但那是 MMD 卡；只有真的酒館卡才是酒館寫法。
  if (obj.spec === "chara_card_v2" || obj.spec === "chara_card_v3" || Array.isArray(raw)) set.format = "tavern";
  return { set, welcome: text(obj.beginning), ...(skippedPromptOnly ? { skippedPromptOnly } : {}) };
}

/**
 * 魅魔島功能欄的「降低層級，勾選後層級位於輸入框下方」對應匯出檔的 pageDepth：
 * 勾了是 1，沒勾是 2（拿兩張已知卡對照確認：勾了降低層級的那張是 1、HUD 蓋在最上面的那張是 2）。
 * 早先這裡寫反了（>= 2 當降低），2026-09 修正；缺欄位就是預設的頁面最上層。
 */
export function loweredFromPageDepth(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "0" || s === "1" || s === "under" || s === "below";
}

export function ruleSetToExport(set: RegexRuleSet, welcome: string): MeimoRegexFile {
  const file: MeimoRegexFile = { pageDepth: set.lowered ? 1 : 2, statusbar: set.statusbar, beginning: welcome, regex_scripts: rulesToTavern(set.rules) };
  if (typeof set.cardCss === "string") {
    file.cardCss = set.cardCss;
    if (set.cardCssDialect) file.cardCssDialect = set.cardCssDialect;
  }
  // 新版卡的匯出檔第一個鍵就是 chatVersion；舊版檔沒有這個鍵，原站據此分辨，所以舊版不能寫 0。
  if (set.pageMode === "sandbox") return { chatVersion: 1, ...file };
  return file;
}

// ── 上游的「作者資產」形狀 ──────────────────────────────────────────────

/** 上游存的形狀：規則同形，功能欄叫 mountTrigger，層級叫 mountLayer（under / over / cover）。 */
export interface AuthorAssetLike {
  rules?: unknown;
  mountTrigger?: string;
  mountLayer?: string;
  pageMode?: string;
  cardFormat?: string;
  openingPage?: string;
  openingMode?: string;
  cardCss?: string;
  cardCssDialect?: string;
}

/** 只搬移舊匯入器生成的純 CSS 載體，編輯過的 HTML 與停用規則原樣保留。 */
function migrateLegacyCardCss(set: RegexRuleSet, asset: AuthorAssetLike): void {
  if (typeof asset.cardCss === "string") {
    set.cardCss = asset.cardCss;
    const dialect = cssDialectFrom(asset.cardCssDialect);
    if (dialect) set.cardCssDialect = dialect;
  }
  const candidates = set.rules.filter(r => r.id === LEGACY_FENGYUE_CSS_RULE_ID);
  if (candidates.length !== 1) return;
  const rule = candidates[0];
  if (!rule.enabled || rule.find !== "/([\\s\\S])$/") return;
  const match = /^\$1<style>([\s\S]*?)<\/style>$/.exec(rule.replace);
  // CSS 字串裡若出現提早閉合 style 的內容，不當成可安全搬移的單一樣式。
  if (!match || /<\/?style\b/i.test(match[1])) return;
  if (!("cardCss" in set)) {
    set.cardCss = match[1];
    set.cardCssDialect = rule.cssDialect ?? "fengyue";
  }
  set.rules = set.rules.filter(r => r !== rule);
}

export function ruleSetFromAuthorAsset(asset: AuthorAssetLike): RegexRuleSet {
  const native = ruleSetFromNative({ rules: Array.isArray(asset.rules) ? asset.rules : [] }) ?? emptyRuleSet();
  const layer = text(asset.mountLayer);
  const set: RegexRuleSet = { ...native, statusbar: text(asset.mountTrigger), lowered: layer === "under" };
  if (layer === "cover") set.mountLayer = "cover";
  const pageMode = pageModeFrom(asset.pageMode);
  if (pageMode) set.pageMode = pageMode;
  const format = cardFormatFrom(asset.cardFormat);
  if (format) set.format = format;
  if (text(asset.openingPage)) set.openingPage = String(asset.openingPage);
  const mode = openingModeFrom(asset.openingMode);
  if (mode) set.openingMode = mode;
  migrateLegacyCardCss(set, asset);
  return set;
}

export function ruleSetToAuthorAsset(set: RegexRuleSet, version: number): Required<Omit<AuthorAssetLike, "openingMode" | "cardCss" | "cardCssDialect">> & { openingMode?: OpeningMode; cardCss?: string; cardCssDialect?: string; rules: RegexRule[]; version: number } {
  const mountLayer = set.lowered ? "under" : set.mountLayer === "cover" ? "cover" : "over";
  return {
    rules: set.rules.map((r) => ({ id: r.id, name: r.name, find: r.find, replace: r.replace, enabled: r.enabled, ...(r.targets ? { targets: r.targets } : {}), ...(r.cssDialect ? { cssDialect: r.cssDialect } : {}) })),
    mountTrigger: set.statusbar,
    mountLayer,
    pageMode: set.pageMode ?? "",
    cardFormat: set.format ?? "",
    openingPage: set.openingPage ?? "",
    ...(typeof set.cardCss === "string" ? { cardCss: set.cardCss, cardCssDialect: set.cardCssDialect ?? "" } : {}),
    // 沒選過就不送，上游保留原值（新卡照卡片格式給預設）
    ...(set.openingMode ? { openingMode: set.openingMode } : {}),
    version,
  };
}
