/**
 * 正則規則：作者替 AI 回覆寫的一組「找到 → 換成」。
 *
 * 用途是把 AI 吐出的標記（『台詞』、<status>…</status>、《美1》這類佔位）在畫面上換成有樣式、
 * 有互動的 HTML。這是酒館與同類站台共有的玩法，資料形狀也跟它們對齊，卡片才搬得動：
 *   - 酒館：`extensions.regex_scripts[]`，欄位 scriptName / findRegex / replaceString / disabled
 *   - 魅魔島匯出：`{ pageDepth, statusbar, beginning, regex_scripts[] }`，條目只有 id / scriptName / findRegex / replaceString
 *
 * `find` 有兩種寫法：`/pattern/flags` 是正則（JS 語法，替換裡的 $1 原樣可用）；不是這個形狀就是
 * 字面字串，全部出現處都換。樣例資料 38 條裡 33 條是字面標記，這不是邊角情況。
 *
 * 規則在**看的人**的瀏覽器裡跑：對話頁把 AI 回覆先過一遍規則再渲染。替換內容裡的 script / style
 * 會執行——這跟本站「AI 生成的 HTML 卡」是同一個信任模型，不是漏洞。
 */

export interface RegexRule {
  id: string;
  name: string;
  /** `/pattern/flags` 或字面字串。 */
  find: string;
  replace: string;
  enabled: boolean;
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
  /** 上游的頁面模式（classic / immersive）；同樣只是帶著走。 */
  pageMode?: string;
}

/** 上限對齊上游作者資產：單條替換 32 KB、整份 1 MB，都以 UTF-8 位元組計。 */
export const REGEX_LIMITS = {
  rules: 100,
  name: 40,
  find: 1000,
  /** 單條替換內容（位元組）。 */
  replaceBytes: 32 * 1024,
  statusbar: 4000,
  /** 整份 JSON 的上限（位元組）。 */
  total: 1024 * 1024,
} as const;

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export const emptyRuleSet = (): RegexRuleSet => ({ version: 1, rules: [], statusbar: "", lowered: false });

export const newRuleId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const makeRule = (partial: Partial<RegexRule> = {}): RegexRule => ({
  id: newRuleId(),
  name: "",
  find: "",
  replace: "",
  enabled: true,
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
export function applyRules(text: string, rules: RegexRule[]): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled || !rule.find) continue;
    const parsed = parseFind(rule.find);
    if (parsed instanceof Error) continue;
    out = typeof parsed === "string" ? replaceAllLiteral(out, parsed, rule.replace) : out.replace(parsed, rule.replace);
  }
  return out;
}

/** 套用一整組到一則 AI 回覆。 */
export function renderWithRules(text: string, set: RegexRuleSet): string {
  return applyRules(text, set.rules);
}

/** 功能欄展開後的 HTML；沒填就是空字串（畫面不渲染那一層）。 */
export function renderStatusbar(set: RegexRuleSet): string {
  return set.statusbar ? applyRules(set.statusbar, set.rules) : "";
}

/** 哪些規則有問題。key 是 i18n key，畫面翻譯。 */
export interface RuleIssue { ruleId: string; key: string; params?: Record<string, string | number> }
export function validateRuleSet(set: RegexRuleSet): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (set.rules.length > REGEX_LIMITS.rules) issues.push({ ruleId: "", key: "regex.issue.tooMany", params: { max: REGEX_LIMITS.rules } });
  for (const rule of set.rules) {
    if (!rule.find.trim()) issues.push({ ruleId: rule.id, key: "regex.issue.emptyFind" });
    if ([...rule.name].length > REGEX_LIMITS.name) issues.push({ ruleId: rule.id, key: "regex.issue.nameLong", params: { max: REGEX_LIMITS.name } });
    if ([...rule.find].length > REGEX_LIMITS.find) issues.push({ ruleId: rule.id, key: "regex.issue.findLong", params: { max: REGEX_LIMITS.find } });
    if (utf8Bytes(rule.replace) > REGEX_LIMITS.replaceBytes) issues.push({ ruleId: rule.id, key: "regex.issue.replaceLong", params: { max: REGEX_LIMITS.replaceBytes / 1024 } });
    if (parseFind(rule.find) instanceof Error) issues.push({ ruleId: rule.id, key: "regex.issue.badRegex" });
  }
  if ([...set.statusbar].length > REGEX_LIMITS.statusbar) issues.push({ ruleId: "", key: "regex.issue.statusbarLong", params: { max: REGEX_LIMITS.statusbar } });
  if (utf8Bytes(JSON.stringify(set)) > REGEX_LIMITS.total) issues.push({ ruleId: "", key: "regex.issue.totalLong" });
  return issues;
}

// ── 匯入 / 匯出 ─────────────────────────────────────────────────────────

/** 酒館的 regex_scripts 條目（與魅魔島匯出共用同一組欄位名）。 */
export interface TavernRegexScript {
  id?: unknown;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function rulesFromTavern(scripts: unknown): RegexRule[] {
  if (!Array.isArray(scripts)) return [];
  return (scripts as TavernRegexScript[])
    .filter((s) => s && typeof s === "object" && text(s.findRegex))
    .map((s, i) => makeRule({ name: text(s.scriptName) || `#${i + 1}`, find: text(s.findRegex), replace: text(s.replaceString), enabled: s.disabled !== true }));
}

export function rulesToTavern(rules: RegexRule[]): TavernRegexScript[] {
  return rules.map((r, i) => ({ id: i + 1, scriptName: r.name, findRegex: r.find, replaceString: r.replace, disabled: !r.enabled }));
}

/** 魅魔島的匯出檔。`beginning` 是第一句話（開場白），跟規則分開回給呼叫端決定要不要蓋。 */
export interface MeimoRegexFile {
  pageDepth?: number;
  statusbar?: string;
  beginning?: string;
  regex_scripts?: TavernRegexScript[];
}

/** 本站自己存的文件（lunatalk.regexRules.v1）讀回來。欄位缺的補預設，壞條目丟掉。 */
function ruleSetFromNative(obj: Record<string, unknown>): RegexRuleSet | null {
  if (!Array.isArray(obj.rules)) return null;
  const rules: RegexRule[] = (obj.rules as Partial<RegexRule>[])
    .filter((r) => r && typeof r === "object" && text(r.find))
    .map((r) => ({ id: text(r.id) || newRuleId(), name: text(r.name), find: text(r.find), replace: text(r.replace), enabled: r.enabled !== false }));
  return { version: 1, rules, statusbar: text(obj.statusbar), lowered: obj.lowered === true };
}

export function ruleSetFromImport(raw: unknown): { set: RegexRuleSet; welcome: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // 自己存的形狀：rules 陣列直接讀，不需要走酒館欄位名的對映
  if (Array.isArray(obj.rules)) {
    const native = ruleSetFromNative(obj);
    return native && native.rules.length ? { set: native, welcome: "" } : null;
  }
  // 三種來源：魅魔島檔、酒館卡（extensions.regex_scripts）、裸陣列
  let scripts: unknown = obj.regex_scripts;
  if (!scripts && obj.data && typeof obj.data === "object") scripts = (obj.data as { extensions?: { regex_scripts?: unknown } }).extensions?.regex_scripts;
  if (!scripts && Array.isArray(raw)) scripts = raw;
  const rules = rulesFromTavern(scripts);
  if (!rules.length) return null;
  // 魅魔島 pageDepth：1 = 頁面最上層（預設），2 = 勾了「降低層級」放輸入框之下。樣例檔就是 2。
  return { set: { version: 1, rules, statusbar: text(obj.statusbar), lowered: Number(obj.pageDepth) >= 2 }, welcome: text(obj.beginning) };
}

export function ruleSetToExport(set: RegexRuleSet, welcome: string): MeimoRegexFile {
  return { pageDepth: set.lowered ? 2 : 1, statusbar: set.statusbar, beginning: welcome, regex_scripts: rulesToTavern(set.rules) };
}

// ── 上游的「作者資產」形狀 ──────────────────────────────────────────────

/** 上游存的形狀：規則同形，功能欄叫 mountTrigger，層級叫 mountLayer（under / over / cover）。 */
export interface AuthorAssetLike {
  rules?: unknown;
  mountTrigger?: string;
  mountLayer?: string;
  pageMode?: string;
}

export function ruleSetFromAuthorAsset(asset: AuthorAssetLike): RegexRuleSet {
  const native = ruleSetFromNative({ rules: Array.isArray(asset.rules) ? asset.rules : [] }) ?? emptyRuleSet();
  const layer = text(asset.mountLayer);
  const set: RegexRuleSet = { ...native, statusbar: text(asset.mountTrigger), lowered: layer === "under" };
  if (layer === "cover") set.mountLayer = "cover";
  if (text(asset.pageMode)) set.pageMode = text(asset.pageMode);
  return set;
}

export function ruleSetToAuthorAsset(set: RegexRuleSet, version: number): Required<AuthorAssetLike> & { rules: RegexRule[]; version: number } {
  const mountLayer = set.lowered ? "under" : set.mountLayer === "cover" ? "cover" : "over";
  return {
    rules: set.rules.map((r) => ({ id: r.id, name: r.name, find: r.find, replace: r.replace, enabled: r.enabled })),
    mountTrigger: set.statusbar,
    mountLayer,
    pageMode: set.pageMode ?? "",
    version,
  };
}
