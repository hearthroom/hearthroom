/**
 * 日里（talkaicc.com / Rili AI）匯出檔與獨立世界書的匯入轉換。
 *
 * 支援四種日里原生 JSON：
 *   - 整卡匯出 `<標題>.json`（含 title、description、introPage、prompt.*、assistantRegexReplace、injectStyles、memorySchema 等）
 *   - 對話覆寫設定 `rili-chat-settings-<cardId>.json`
 *   - 模組檔 `rili-mod-<id>.json`（`format: "rili-mod"`，內容在 payload 與 injectedStyles）
 *   - 獨立世界書 `lorebook.json`（僅含 `{ prompt: { lorebook: [...] } }`，依 UI 規格 D5 歸入三件套世界書槽或世界書單獨匯入）
 */

import {
  bookEntriesToDrafts,
  bookEntryDrops,
  countSplitEntries,
  entryContentMax,
  TAGS_MAX,
  type DropNote,
  type ImportResult,
  type TavernBook,
  type TavernBookEntry,
} from "./tavern";
import { fallbackLimits, makeDraft } from "./role-draft";
import { formatJson, STATE_LIMITS, stateProblem, type CardStateDraft } from "./card-state";
import type { RegexMessageTarget, RegexRule, RegexRuleSet } from "./regex-rules";

type Raw = Record<string, unknown>;

export interface RiliImportResult extends ImportResult {
  spec: "rili";
  intro: string;
}

export interface RiliEntryMeta {
  triggerRegion: string;
  region: boolean;
  position: boolean;
  probability: boolean;
  weighted: boolean;
  blacklistOnAnd: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strList = (v: unknown): string[] => listOf(v).map(str).filter(Boolean);

const KNOWN_TOP_KEYS = new Set([
  "id",
  "authorId",
  "title",
  "description",
  "background",
  "backgroundWidth",
  "backgroundHeight",
  "cover",
  "coverWidth",
  "coverHeight",
  "introPage",
  "changelog",
  "createdAt",
  "updatedAt",
  "initPublicAt",
  "prompt",
  "promptSizeBytes",
  "renderTemplate",
  "assistantRegexReplace",
  "assistantRegexReplaceSizeBytes",
  "enableMemorySchema",
  "memorySchema",
  "injectStyles",
  "injectStylesSizeBytes",
  "injectedStyles",
  "options",
  "language",
  "containsNSFW",
  "publicAccess",
  "deletedAt",
  "isAnonymous",
  "enableSafeguard",
  "defaultModelSettings",
  "model",
  "contextWindow",
  "modelSettings",
  "assistantPrefill",
  "totalConversations",
  "totalPlayedUsers",
  "deeplyPlayed",
  "maxNonAuthorPlayCount",
  "fixedPromptLength",
  "lorebookLength",
  "cardsTags",
  "cardsVoices",
  "format",
  "formatVersion",
  "payload",
  "name",
]);

const KNOWN_PROMPT_KEYS = new Set([
  "systemPrompt",
  "headPrompt",
  "rearPrompt",
  "suggestionsPrompt",
  "lorebook",
]);

const RILI_CARD_SIGNAL_KEYS = [
  "title",
  "introPage",
  "assistantRegexReplace",
  "injectStyles",
  "enableMemorySchema",
  "memorySchema",
  "renderTemplate",
  "defaultModelSettings",
  "modelSettings",
  "cardsTags",
  "options",
  "assistantPrefill",
];

function isRiliLorebookEntry(item: unknown): item is Raw {
  return isObj(item) && Array.isArray(item.triggerWords) && ("content" in item || "contents" in item);
}

function isValidRiliLorebookArray(value: unknown): value is Raw[] {
  return Array.isArray(value) && value.every(isRiliLorebookEntry);
}

/** 獨立世界書檔 `lorebook.json`（只有 prompt.lorebook，沒有整卡或對話設定欄位）。 */
export function isRiliLorebook(raw: unknown): raw is Raw {
  if (!isObj(raw) || raw.format === "rili-mod") return false;
  const keys = Object.keys(raw);
  if (!keys.length || !keys.every((k) => k === "prompt" || k === "promptSizeBytes" || k === "lorebookLength")) {
    return false;
  }
  const prompt = raw.prompt;
  if (!isObj(prompt)) return false;
  const pKeys = Object.keys(prompt);
  return pKeys.length > 0 && pKeys.every((k) => k === "lorebook") && isValidRiliLorebookArray(prompt.lorebook);
}

/** 整卡、對話設定覆寫檔或 rili-mod 模組檔（獨立 lorebook.json 不算整卡，回 false）。 */
export function isRiliExport(raw: unknown): raw is Raw {
  if (isRiliLorebook(raw) || !isObj(raw)) return false;
  if (raw.format === "rili-mod") return isObj(raw.payload);
  const prompt = raw.prompt;
  if (!isObj(prompt)) return false;
  if ("lorebook" in prompt && prompt.lorebook != null && !isValidRiliLorebookArray(prompt.lorebook)) {
    return false;
  }
  const hasPromptField =
    "systemPrompt" in prompt ||
    "headPrompt" in prompt ||
    "rearPrompt" in prompt ||
    "suggestionsPrompt" in prompt ||
    isValidRiliLorebookArray(prompt.lorebook);
  if (!hasPromptField) return false;
  if (RILI_CARD_SIGNAL_KEYS.some((k) => k in raw)) return true;
  return "systemPrompt" in prompt && ("headPrompt" in prompt || "rearPrompt" in prompt);
}

function formatRiliEntryName(folder: string, index: number): string {
  const suffix = `#${index}`;
  if (!folder) return suffix;
  const maxFolder = Math.max(1, 20 - 3 - [...suffix].length);
  const shortFolder = [...folder].slice(0, maxFolder).join("");
  return `[${shortFolder}] ${suffix}`;
}

/**
 * 日里世界書條目 → TavernBookEntry（供整卡匯入、獨立世界書匯入與三件套世界書槽共用）。
 * 日里專屬的觸發範圍與摘要旗標暫存於 extensions.__rili，由 bookEntriesToDrafts / bookEntryDrops 消費並剝除。
 */
export function convertRiliLorebookEntries(rows: Raw[]): TavernBookEntry[] {
  return rows.map((row, idx) => {
    const folder = str(row.folder);
    const name = formatRiliEntryName(folder, idx + 1);
    const words = strList(row.triggerWords);
    const blacks = strList(row.blackListWords);
    const isAnd = str(row.triggerWordsType).toUpperCase() === "AND" && words.length >= 2;

    let keys = words;
    let secondaryKeys: string[] = [];
    let selective = false;
    let selectiveLogic = 0;
    let blacklistOnAnd = false;

    if (isAnd) {
      keys = [words[0]];
      secondaryKeys = words.slice(1);
      selective = true;
      selectiveLogic = 3;
      if (blacks.length > 0) blacklistOnAnd = true;
    } else if (blacks.length > 0) {
      keys = words;
      secondaryKeys = blacks;
      selective = true;
      selectiveLogic = str(row.blackListWordsType).toUpperCase() === "AND" ? 1 : 2;
    }

    let weighted = false;
    let content = typeof row.content === "string" ? row.content.trim() : "";
    if (str(row.contentMethod) === "weighted" && Array.isArray(row.contents)) {
      const parts = row.contents
        .filter(isObj)
        .map((c) => (typeof c.content === "string" ? c.content.trim() : ""))
        .filter(Boolean);
      content = parts.join("\n\n");
      weighted = true;
    }

    const ranges = strList(row.triggerRange);
    const hasUser = ranges.includes("user");
    const hasAssistant = ranges.includes("assistant");
    const hasOther = ranges.some((r) => r !== "user" && r !== "assistant");
    const triggerRegion = hasUser && !hasAssistant ? "user_only" : hasAssistant && !hasUser ? "ai_only" : "";
    const region = hasOther || (Array.isArray(row.triggerRange) && ranges.length > 0 && !hasUser && !hasAssistant);

    const impacts = strList(row.impactRange);
    const position = impacts.some((r) => r !== "system");
    const probability = row.probability !== undefined && Number(row.probability) !== 100;

    const order = Number.isInteger(Number(row.priority)) ? Number(row.priority) : 0;
    const depth = Number(row.scanDepth);

    const meta: RiliEntryMeta = {
      triggerRegion,
      region,
      position,
      probability,
      weighted,
      blacklistOnAnd,
    };

    return {
      name,
      keys,
      secondary_keys: secondaryKeys,
      selective,
      selective_logic: selectiveLogic,
      content,
      enabled: row.enabled !== false,
      insertion_order: order,
      ...(Number.isInteger(depth) && depth > 0 && depth <= 100 ? { scan_depth: depth } : {}),
      extensions: { __rili: meta },
    };
  });
}

/** 從日里獨立 lorebook.json 或含世界書的日里整卡抽出 TavernBook。 */
export function riliBookFromRaw(raw: unknown): TavernBook | null {
  if (isRiliLorebook(raw)) {
    const prompt = raw.prompt as Raw;
    const rows = (prompt.lorebook as Raw[]) ?? [];
    return {
      name: "",
      description: "",
      entries: convertRiliLorebookEntries(rows),
    };
  }
  if (isRiliExport(raw)) {
    const source = raw.format === "rili-mod" && isObj(raw.payload) ? raw.payload : raw;
    const prompt = isObj(source.prompt) ? source.prompt : null;
    const rows = prompt && isValidRiliLorebookArray(prompt.lorebook) ? prompt.lorebook : [];
    if (!rows.length) return null;
    return {
      name: str(raw.title),
      description: "",
      entries: convertRiliLorebookEntries(rows),
    };
  }
  return null;
}

const RILI_SLASH_REGEX = /^\/([\s\S]+)\/([gimsuy]*)$/;

function escapeBareSlashes(source: string): string {
  let out = "";
  let escaped = false;
  for (const ch of source) {
    if (ch === "/" && !escaped) out += "\\/";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\n") out += "\\n";
    else out += ch;
    escaped = ch === "\\" && !escaped;
  }
  return out;
}

function escapeLiteralForRegex(literal: string): string {
  return literal
    .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/**
 * 日里正則語意：只有 `/pattern/flags`（旗標 g/i/m/s/u/y）在原站才會當正則編譯；
 * 無斜線字串在原站一律走純文字 split/join，必須跳脫所有正則字元再包成 `/.../g`。
 */
export function riliRegexFind(pattern: string): string {
  const match = RILI_SLASH_REGEX.exec(pattern);
  if (match) {
    return `/${escapeBareSlashes(match[1])}/${match[2]}`;
  }
  return `/${escapeLiteralForRegex(pattern)}/g`;
}

const ROLE_TARGETS: Record<string, RegexMessageTarget[]> = {
  assistant: ["ai"],
  user: ["user"],
  all: ["ai", "user"],
};

function convertRegex(rows: Raw[], notes: DropNote[]): RegexRule[] {
  const valid = rows.filter((r) => typeof r.regex === "string" && r.regex.trim() !== "");
  const backendCount = valid.filter((r) => str(r.applyMode) === "backend").length;
  const kept = valid.filter((r) => str(r.applyMode) !== "backend");
  const historyCount = kept.filter((r) => str(r.applyMode) === "all").length;
  const unknownScope = kept.filter((r) => r.messageRole !== undefined && !(str(r.messageRole) in ROLE_TARGETS)).length;

  if (backendCount) notes.push({ key: "import.rili.regexBackend", params: { n: backendCount }, level: "changed" });
  if (historyCount) notes.push({ key: "import.rili.regexHistory", params: { n: historyCount }, level: "changed" });
  if (unknownScope) notes.push({ key: "import.fengyue.regexScope", params: { n: unknownScope }, level: "changed" });

  return kept.map((r, i) => {
    const role = str(r.messageRole) || "assistant";
    const targets = ROLE_TARGETS[role];
    return {
      id: `rili-${i + 1}`,
      name: [...(str(r.name) || `#${i + 1}`)].slice(0, 40).join(""),
      find: riliRegexFind(String(r.regex)),
      replace: typeof r.replaceString === "string" ? r.replaceString : "",
      enabled: r.enabled !== false,
      ...(targets ? { targets: [...targets] } : {}),
    };
  });
}

const isIdentChar = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9_$]/.test(ch);

function rewriteHandlebarsTag(tag: string): string {
  const needle = "workingMemory";
  let out = "";
  let i = 0;
  while (i < tag.length) {
    const idx = tag.indexOf(needle, i);
    if (idx < 0) {
      out += tag.slice(i);
      break;
    }
    out += tag.slice(i, idx);
    const prev = idx > 0 ? tag[idx - 1] : undefined;
    const afterIdx = idx + needle.length;
    const next = afterIdx < tag.length ? tag[afterIdx] : undefined;
    if (!isIdentChar(prev) && prev !== "." && !isIdentChar(next)) {
      if (next === "." && afterIdx + 1 < tag.length && !/[\s}]/.test(tag[afterIdx + 1])) {
        i = afterIdx + 1;
        continue;
      }
      out += ".";
      i = afterIdx;
      continue;
    }
    out += needle;
    i = afterIdx;
  }
  return out;
}

/** 把 renderTemplate 裡的 `{{workingMemory.xxx}}` 改寫成 `{{xxx}}`、`{{#with workingMemory}}` 改寫成 `{{#with .}}`。 */
export function rewriteRenderTemplate(content: string): string {
  return content.replace(/\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g, rewriteHandlebarsTag);
}

const keyPath = (p: string, key: string): string =>
  key === "" || /[.[\]"]/.test(key) ? `${p}["${key}"]` : p ? `${p}.${key}` : key;

function inferSchemaType(node: Raw): string {
  const t = str(node.type);
  if (t) return t;
  if (isObj(node.properties)) return "object";
  if ("items" in node) return "array";
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const first = node.enum[0];
    if (typeof first === "boolean") return "boolean";
    if (typeof first === "number") return Number.isInteger(first) ? "integer" : "number";
  }
  return "string";
}

function formatSchemaNodeRule(node: Raw): string {
  const t = inferSchemaType(node);
  const desc = str(node.description);
  const constraints: string[] = [];
  if (t === "integer") constraints.push("integer");
  if (typeof node.minimum === "number" && Number.isFinite(node.minimum)) constraints.push(`min: ${node.minimum}`);
  if (typeof node.maximum === "number" && Number.isFinite(node.maximum)) constraints.push(`max: ${node.maximum}`);
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    constraints.push(`enum: ${node.enum.map((v) => JSON.stringify(v)).join(" | ")}`);
  }
  let base = desc && constraints.length ? `${desc} (${constraints.join(", ")})` : desc || constraints.join(", ");
  if (t === "array" && isObj(node.items)) {
    let itemRule = formatSchemaNodeRule(node.items);
    if (isObj(node.items.properties)) {
      const propRules = Object.entries(node.items.properties)
        .filter(([, v]) => isObj(v))
        .map(([k, v]) => {
          const r = formatSchemaNodeRule(v as Raw);
          return r ? `${k}: ${r}` : k;
        });
      if (propRules.length) {
        const propsSummary = `{${propRules.join("; ")}}`;
        itemRule = itemRule ? `${itemRule} ${propsSummary}` : propsSummary;
      }
    }
    if (itemRule) base = base ? `${base}; items: ${itemRule}` : `items: ${itemRule}`;
  }
  return base;
}

function buildSchemaTree(node: Raw, path: string, pathRules: Record<string, string>): unknown {
  const t = inferSchemaType(node);
  const hasProps = t === "object" && isObj(node.properties);

  if (path) {
    const rule = formatSchemaNodeRule(node);
    if (rule) pathRules[path] = rule;
  }

  if (hasProps) {
    const props = node.properties as Raw;
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(props)) {
      const childPath = keyPath(path, k);
      if (isObj(child)) {
        out[k] = buildSchemaTree(child, childPath, pathRules);
      } else {
        out[k] = "";
      }
    }
    if ("default" in node && isObj(node.default)) {
      for (const [k, v] of Object.entries(node.default)) {
        if (k in out) out[k] = JSON.parse(JSON.stringify(v));
      }
    }
    return out;
  }

  if ("default" in node && node.default !== undefined) {
    return JSON.parse(JSON.stringify(node.default));
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return JSON.parse(JSON.stringify(node.enum[0]));
  }
  switch (t) {
    case "object":
      return {};
    case "array":
      return [];
    case "integer":
    case "number": {
      const min = typeof node.minimum === "number" && Number.isFinite(node.minimum) ? node.minimum : undefined;
      const max = typeof node.maximum === "number" && Number.isFinite(node.maximum) ? node.maximum : undefined;
      if (min !== undefined && min > 0) return min;
      if (max !== undefined && max < 0) return max;
      return 0;
    }
    case "boolean":
      return false;
    default:
      return "";
  }
}

function convertMemorySchema(raw: Raw, notes: DropNote[]): CardStateDraft | null {
  const enabled = raw.enableMemorySchema === true;
  const rawSchema =
    typeof raw.memorySchema === "string"
      ? raw.memorySchema.trim()
      : isObj(raw.memorySchema)
        ? formatJson(raw.memorySchema)
        : "";
  const rt = isObj(raw.renderTemplate) ? raw.renderTemplate : null;
  const rawTemplate = rt && typeof rt.content === "string" ? rt.content.trim() : "";
  const template = rawTemplate ? rewriteRenderTemplate(rawTemplate) : "";
  const usesSuggestions =
    Boolean(rt?.injectSuggestions) || /\{\{[^{}]*\bsuggestions\b/.test(rawTemplate);

  if (!enabled) {
    if (rawSchema) notes.push({ key: "import.rili.memoryDisabled", level: "info" });
    if (rawTemplate) notes.push({ key: "import.fengyue.variablesTemplateOnly", level: "info" });
    return null;
  }
  if (!rawSchema) {
    if (rawTemplate) notes.push({ key: "import.fengyue.variablesTemplateOnly", level: "info" });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSchema);
  } catch {
    notes.push({ key: "import.rili.memoryInvalid", level: "block" });
    if (template && usesSuggestions) notes.push({ key: "import.rili.templateSuggestions", level: "changed" });
    return { convention: "plain", dataText: rawSchema, rulesText: "", template };
  }

  if (
    !isObj(parsed) ||
    ("type" in parsed && (typeof parsed.type !== "string" || parsed.type.trim() !== "object"))
  ) {
    notes.push({ key: "import.rili.memoryInvalid", level: "block" });
    if (template && usesSuggestions) notes.push({ key: "import.rili.templateSuggestions", level: "changed" });
    return {
      convention: "plain",
      dataText: isObj(parsed) ? JSON.stringify(rawSchema) : rawSchema,
      rulesText: "",
      template,
    };
  }

  const pathRules: Record<string, string> = {};
  const built = buildSchemaTree(parsed, "", pathRules);
  if (!isObj(built)) {
    notes.push({ key: "import.rili.memoryInvalid", level: "block" });
    if (template && usesSuggestions) notes.push({ key: "import.rili.templateSuggestions", level: "changed" });
    return { convention: "plain", dataText: JSON.stringify(rawSchema), rulesText: "", template };
  }

  const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
  let rulesText = str(parsed.description);
  let activePathRules: Record<string, string> | undefined = Object.keys(pathRules).length ? pathRules : undefined;
  if (activePathRules) {
    let pathBytes = 0;
    for (const [k, v] of Object.entries(activePathRules)) {
      const trimmed = v.trim();
      if (trimmed) pathBytes += utf8Bytes(k) + utf8Bytes(trimmed);
    }
    if (pathBytes > STATE_LIMITS.rulePathBytes) {
      const lines = Object.entries(activePathRules)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k}: ${v.trim()}`)
        .join("\n");
      rulesText = !lines ? rulesText : rulesText ? `${rulesText}\n\n${lines}` : lines;
      activePathRules = undefined;
    }
  }

  const candidate: CardStateDraft = {
    convention: "plain",
    dataText: formatJson(built),
    rulesText,
    template,
    ...(activePathRules ? { pathRules: activePathRules } : {}),
  };

  if (stateProblem(candidate)) {
    notes.push({ key: "import.rili.memoryLimit", level: "block" });
  } else {
    notes.push({ key: "import.rili.memoryConverted", level: "changed" });
  }
  if (template && usesSuggestions) {
    notes.push({ key: "import.rili.templateSuggestions", level: "changed" });
  }

  return candidate;
}

function hasNonEmptyContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObj(value)) {
    return Object.values(value).some(
      (v) => v !== null && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0),
    );
  }
  if (typeof value === "string") {
    const s = value.trim();
    return /^https?:\/\//i.test(s) || [...s].length > 30 || value.includes("\n");
  }
  return false;
}

function hasModelSettings(raw: Raw): boolean {
  if (str(raw.model)) return true;
  if (typeof raw.contextWindow === "number" && raw.contextWindow > 0) return true;
  if (isObj(raw.modelSettings) && Object.keys(raw.modelSettings).length > 0) return true;
  if (isObj(raw.defaultModelSettings)) {
    const d = raw.defaultModelSettings;
    return (
      Boolean(str(d.model)) ||
      (typeof d.contextWindow === "number" && d.contextWindow > 0) ||
      (isObj(d.modelSettings) && Object.keys(d.modelSettings).length > 0)
    );
  }
  return false;
}

function reportUnmappedFeatures(raw: Raw, source: Raw, prompt: Raw, isMod: boolean, notes: DropNote[]) {
  if (isMod) notes.push({ key: "import.rili.modFile", level: "info" });

  if (str(source.cover) || str(source.background)) {
    notes.push({ key: "import.rili.images", level: "info" });
  }

  const presetCount = isObj(source.options) ? listOf(source.options.items).filter(isObj).length : 0;
  if (presetCount) {
    notes.push({ key: "import.rili.presetOptions", params: { n: presetCount }, level: "info" });
  }

  if (str(prompt.suggestionsPrompt)) {
    notes.push({ key: "import.rili.suggestionsPrompt", level: "info" });
  }

  const voicesCount = listOf(source.cardsVoices).filter(isObj).length;
  if (voicesCount) {
    notes.push({ key: "import.rili.voices", params: { n: voicesCount }, level: "info" });
  }

  if (hasModelSettings(source)) {
    notes.push({ key: "import.rili.modelSettings", level: "info" });
  }

  if (source.enableSafeguard === true) {
    notes.push({ key: "import.rili.safeguard", level: "info" });
  }

  if (str(source.assistantPrefill)) {
    notes.push({ key: "import.rili.assistantPrefill", level: "info" });
  }

  let other = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_TOP_KEYS.has(key)) continue;
    if (hasNonEmptyContent(value)) other++;
  }
  if (isMod && source !== raw) {
    for (const [key, value] of Object.entries(source)) {
      if (KNOWN_TOP_KEYS.has(key)) continue;
      if (hasNonEmptyContent(value)) other++;
    }
  }
  for (const [key, value] of Object.entries(prompt)) {
    if (KNOWN_PROMPT_KEYS.has(key)) continue;
    if (hasNonEmptyContent(value)) other++;
  }
  if (other) {
    notes.push({ key: "import.rili.otherFields", params: { n: other }, level: "info" });
  }
}

export function riliToDraft(
  raw: Raw,
  options: { language: string; limits?: Record<string, number> },
): RiliImportResult {
  const { language } = options;
  const notes: DropNote[] = [];
  const draft = makeDraft(language);

  const isMod = raw.format === "rili-mod" && isObj(raw.payload);
  const source = isMod ? (raw.payload as Raw) : raw;
  const prompt = isObj(source.prompt) ? source.prompt : {};

  draft.roleName = str(source.title) || str(raw.title);
  draft.roleDesc = str(source.description) || str(raw.description);
  draft.roleDetailDesc = str(prompt.systemPrompt);
  draft.roleOutputContract = str(prompt.headPrompt);
  draft.jailbreak = str(prompt.rearPrompt);

  const rawTags = listOf(source.cardsTags)
    .filter(isObj)
    .map((item) => (isObj(item.tag) ? str(item.tag.name) : str(item.name)))
    .filter(Boolean);
  draft.roleTag = rawTags.slice(0, TAGS_MAX);
  if (rawTags.length > TAGS_MAX) {
    notes.push({ key: "import.drop.tags", params: { n: rawTags.length - TAGS_MAX }, level: "info" });
  }

  const limits = options.limits ?? fallbackLimits(language);
  const sized: [string, keyof typeof draft, string][] = [
    ["name", "roleName", "roleName"],
    ["summary", "roleDesc", "roleDesc"],
    ["definition", "roleDetailDesc", "roleDetailDesc"],
    ["outputContract", "roleOutputContract", "roleOutputContract"],
    ["custom", "jailbreak", "jailbreak"],
  ];
  for (const [label, field, limitKey] of sized) {
    const n = [...String(draft[field])].length;
    const cap = limits[limitKey];
    if (cap && n > cap) {
      notes.push({ key: `import.fengyue.tooLong.${label}`, params: { n, max: cap }, level: "block" });
    }
  }

  const intro = typeof source.introPage === "string" ? source.introPage.trim() : "";
  if (!intro) {
    notes.push({ key: "import.rili.noWelcome", level: "block" });
  }

  let worldbook: ImportResult["worldbook"] = null;
  const bookRows = listOf(prompt.lorebook).filter(isObj);
  if (bookRows.length) {
    const entries = convertRiliLorebookEntries(bookRows);
    const drafts = bookEntriesToDrafts(entries, undefined, language);
    worldbook = { name: draft.roleName, description: "", format: "tavern", entries: drafts };
    notes.push(...bookEntryDrops(entries));
    const split = countSplitEntries(entries, language);
    if (split) {
      notes.push({
        key: "import.split.entries",
        params: { n: split, max: entryContentMax(language) },
        level: "changed",
      });
    }
  }

  const rules = convertRegex(listOf(source.assistantRegexReplace).filter(isObj), notes);
  const css =
    typeof source.injectStyles === "string"
      ? source.injectStyles
      : typeof raw.injectedStyles === "string"
        ? raw.injectedStyles
        : typeof source.injectedStyles === "string"
          ? source.injectedStyles
          : "";
  const regex: RegexRuleSet | null =
    rules.length || intro || css
      ? {
          version: 1,
          rules,
          statusbar: "",
          lowered: false,
          pageMode: "sandbox",
          format: "fengyue",
          ...(intro ? { openingPage: intro } : {}),
          ...(css ? { cardCss: css, cardCssDialect: "rili" } : {}),
        }
      : null;

  draft.state = convertMemorySchema(source, notes);
  reportUnmappedFeatures(raw, source, prompt, isMod, notes);

  return {
    draft,
    worldbook,
    dropped: notes,
    image: null,
    background: null,
    spec: "rili",
    regex,
    intro,
  };
}

async function parseJsonFile(file: File): Promise<unknown> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const start = new TextDecoder().decode(head).replace(/^\uFEFF/, "").trimStart();
  if (!start.startsWith("{")) return null;
  try {
    return JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** 讀取日里整卡／對話設定／模組檔；不是日里卡（含獨立 lorebook.json）回 null。 */
export async function readRiliFile(file: File): Promise<Raw | null> {
  const raw = await parseJsonFile(file);
  return isRiliExport(raw) ? raw : null;
}

/** 讀取日里獨立世界書 `lorebook.json`；不是獨立世界書回 null。 */
export async function readRiliLorebookFile(file: File): Promise<Raw | null> {
  const raw = await parseJsonFile(file);
  return isRiliLorebook(raw) ? raw : null;
}
