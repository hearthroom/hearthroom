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
  /** 接在最近幾則 AI 回覆後面的一段固定文字（多半是一排佔位標記，由規則展開成面板）。 */
  statusbar: string;
  /** statusbar 接在最近幾則回覆後面。1 = 只有最新那則。 */
  depth: number;
}

export const REGEX_LIMITS = {
  rules: 100,
  name: 40,
  find: 1000,
  replace: 20000,
  statusbar: 4000,
  /** 整份 JSON 的上限（位元組）。 */
  total: 600_000,
} as const;

export const emptyRuleSet = (): RegexRuleSet => ({ version: 1, rules: [], statusbar: "", depth: 1 });

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

/** 套用一整組到一則 AI 回覆。`isRecent` 決定要不要接 statusbar。 */
export function renderWithRules(text: string, set: RegexRuleSet, isRecent: boolean): string {
  const base = isRecent && set.statusbar ? `${text}\n${set.statusbar}` : text;
  return applyRules(base, set.rules);
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
    if ([...rule.replace].length > REGEX_LIMITS.replace) issues.push({ ruleId: rule.id, key: "regex.issue.replaceLong", params: { max: REGEX_LIMITS.replace } });
    if (parseFind(rule.find) instanceof Error) issues.push({ ruleId: rule.id, key: "regex.issue.badRegex" });
  }
  if ([...set.statusbar].length > REGEX_LIMITS.statusbar) issues.push({ ruleId: "", key: "regex.issue.statusbarLong", params: { max: REGEX_LIMITS.statusbar } });
  if (new TextEncoder().encode(JSON.stringify(set)).length > REGEX_LIMITS.total) issues.push({ ruleId: "", key: "regex.issue.totalLong" });
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
  const depth = typeof obj.depth === "number" && obj.depth > 0 ? Math.min(Math.floor(obj.depth), 50) : 1;
  return { version: 1, rules, statusbar: text(obj.statusbar), depth };
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
  const depth = typeof obj.pageDepth === "number" && obj.pageDepth > 0 ? Math.min(Math.floor(obj.pageDepth), 50) : 1;
  return { set: { version: 1, rules, statusbar: text(obj.statusbar), depth }, welcome: text(obj.beginning) };
}

export function ruleSetToExport(set: RegexRuleSet, welcome: string): MeimoRegexFile {
  return { pageDepth: set.depth, statusbar: set.statusbar, beginning: welcome, regex_scripts: rulesToTavern(set.rules) };
}
