/**
 * 預設文件（hearthroom.st-preset.v1）的編輯操作。文件本體就是 ST 的 Chat Completion 預設
 * （或 Prompt Manager 條目包），原封不動放在 `st`；這裡只改玩家明確動到的那幾個欄位，
 * 其他欄位（不認得的擴充、另一組排序、停用的條目）一律保留，匯出回 ST 才會跟原檔一樣。
 *
 * 相容與否不在這裡判：哪條需調整、哪條不支援，以服務端 analyze 回的 compatibility 為準。
 * 這裡的 slot 只是存檔前的暫時分組，讓列表在服務端回應之前就有位置可放。
 *
 * 函式直接改傳進來的文件（頁面拿的是 reactive 物件），回傳 false 代表這個操作不允許。
 */

export const SCHEMA_VERSION = "hearthroom.st-preset.v1";

export interface StPrompt {
  identifier: string;
  name?: string;
  role?: string;
  content?: string;
  marker?: boolean;
  injection_position?: number;
  [key: string]: unknown;
}
export interface StOrderEntry { identifier: string; enabled: boolean; [key: string]: unknown }
export type StDocument = Record<string, unknown>;
export interface PresetSelection {
  profileId: number;
  excludedEntryIds: string[];
  acceptedAdaptationIds: string[];
  excludedFields: string[];
  /** 用綺夢社自己的回覆工具（整段生成後才顯示）；省略＝關，匯入一律從關開始 */
  toolReply?: boolean;
}
export interface PresetDocument { schemaVersion: string; st: StDocument; selection: PresetSelection }

/** P 固定區（歷史之前）、F 由框架提供、S 生成前（歷史之後）、D 插在歷史中間（不執行）。 */
export type Slot = "P" | "F" | "S" | "D";
/** side：在排序裡位於聊天歷史之前或之後（插在歷史中間的條目也照這個歸區顯示） */
/** enabled：實際會用（來源開著且沒有列為不採用）；sourceEnabled：來源檔裡的開關 */
export interface EntryRow { identifier: string; prompt: StPrompt; enabled: boolean; sourceEnabled: boolean; slot: Slot; side: "before" | "after" }

/** ST 標準的框架佔位：內容由綺夢社的卡片、玩家設定、Lorebook 與聊天歷史提供，不能改、不能關、不能搬。 */
export const FRAMEWORK_IDS: ReadonlySet<string> = new Set([
  "charDescription", "charPersonality", "scenario", "personaDescription",
  "dialogueExamples", "worldInfoBefore", "worldInfoAfter", "chatHistory",
]);
const HISTORY = "chatHistory";
/** ST 的 injection_position：0 相對位置，1 插在聊天歷史第 N 則之間。 */
const IN_CHAT = 1;

export const BASIC_PARAMS = ["temperature", "top_p"] as const;
export const ADVANCED_PARAMS = [
  "top_k", "top_a", "min_p", "frequency_penalty", "presence_penalty", "repetition_penalty",
  "seed", "openai_max_tokens", "reasoning_effort", "verbosity",
] as const;
export type ParamKey = (typeof BASIC_PARAMS)[number] | (typeof ADVANCED_PARAMS)[number];
/** 本站寫的預設上游只收 Temperature 與 Top P；其餘採樣參數只在匯入的酒館預設裡保留與調整 */
export const NATIVE_PARAMS: readonly ParamKey[] = BASIC_PARAMS;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function isPromptPack(st: StDocument): boolean {
  return isObject(st.data) && "type" in st && "version" in st;
}

function promptsOf(st: StDocument): StPrompt[] {
  const holder = isPromptPack(st) ? (st.data as Record<string, unknown>) : st;
  if (!Array.isArray(holder.prompts)) holder.prompts = [];
  return holder.prompts as StPrompt[];
}

/** 來源裡的排序設定（ST 的 character_id）。條目包只有一組，編號 0。 */
export function profilesOf(st: StDocument): number[] {
  if (isPromptPack(st)) return [0];
  return Array.isArray(st.prompt_order) ? (st.prompt_order as { character_id: number }[]).map((p) => p.character_id) : [];
}

function orderOf(doc: PresetDocument): StOrderEntry[] {
  const { st } = doc;
  if (isPromptPack(st)) {
    const data = st.data as Record<string, unknown>;
    if (!Array.isArray(data.prompt_order)) data.prompt_order = [];
    return data.prompt_order as StOrderEntry[];
  }
  if (!Array.isArray(st.prompt_order)) st.prompt_order = [];
  const profiles = st.prompt_order as { character_id: number; order: StOrderEntry[] }[];
  let profile = profiles.find((p) => p.character_id === doc.selection.profileId);
  if (!profile) profiles.push((profile = { character_id: doc.selection.profileId, order: [] }));
  if (!Array.isArray(profile.order)) profile.order = [];
  return profile.order;
}

const findPrompt = (doc: PresetDocument, id: string) => promptsOf(doc.st).find((p) => p.identifier === id);
const isFramework = (id: string) => FRAMEWORK_IDS.has(id);

export function entryRows(doc: PresetDocument): EntryRow[] {
  const order = orderOf(doc);
  const history = order.findIndex((o) => o.identifier === HISTORY);
  return order.flatMap((o, i) => {
    const prompt = findPrompt(doc, o.identifier);
    if (!prompt) return [];
    const slot: Slot = isFramework(o.identifier) ? "F"
      : prompt.injection_position === IN_CHAT ? "D"
      : history >= 0 && i > history ? "S" : "P";
    const side = history >= 0 && i > history ? "after" : "before";
    // 開著＝來源排序裡開著，而且本站沒有把它列為不採用
    const enabled = o.enabled !== false && !doc.selection.excludedEntryIds.includes(o.identifier);
    return [{ identifier: o.identifier, prompt, enabled, sourceEnabled: o.enabled !== false, slot, side }];
  });
}

/** 不在選定排序裡的自訂條目（ST 的「移出」）：內容還在，可以插回去。 */
export function detachedPrompts(doc: PresetDocument): StPrompt[] {
  const used = new Set(orderOf(doc).map((o) => o.identifier));
  return promptsOf(doc.st).filter((p) => !used.has(p.identifier) && !isFramework(p.identifier));
}

/**
 * 開關一個條目。keepSource（匯入的預設）：關掉只記進 excludedEntryIds，來源的 enabled 不動，
 * 匯出回酒館跟原檔一樣；打開時拿掉不採用，來源本來就關著的才改來源（那是玩家明確要開）。
 * 自己寫的預設直接改來源，匯出就是畫面上看到的樣子。
 */
export function setEnabled(doc: PresetDocument, id: string, enabled: boolean, opts: { keepSource?: boolean } = {}): boolean {
  if (isFramework(id)) return false;
  const entry = orderOf(doc).find((o) => o.identifier === id);
  if (!entry) return false;
  const excluded = doc.selection.excludedEntryIds.filter((x) => x !== id);
  if (enabled) entry.enabled = true;
  else if (opts.keepSource) excluded.push(id);
  else entry.enabled = false;
  doc.selection.excludedEntryIds = excluded;
  return true;
}

/** 和同一區相鄰的自訂條目交換位置；框架條目不動，也不跨過聊天歷史。 */
/**
 * 會送出內容的框架 marker：玩家設定、角色設定（畫面上合成「角色與玩家設定」）與對話示例（另一列）。
 * 其他 marker（個性、情境、世界書）是空槽，伺服器不放內容，清單不畫、上下移也不算一步。
 */
export const PERSONA_IDS: ReadonlySet<string> = new Set(["personaDescription", "charDescription"]);
const EXAMPLES_ID = "dialogueExamples";
/** SillyTavern 預設的 prompt_order：marker 缺席時，伺服器照它找最近的錨點補位（server renderPresetPrefixLayout，6376f7af）。 */
const ST_DEFAULT_ORDER = ["main", "worldInfoBefore", "personaDescription", "charDescription", "charPersonality", "scenario", "enhanceDefinitions", "nsfw", "worldInfoAfter", "dialogueExamples"];

/** 對話記錄之前那一區照送出順序的一列。virtual：marker 缺席，位置是伺服器補上的（只顯示，不能拖到它前面、上下移不算一步）。 */
export type PrefixRow = { kind: "entry"; id: string } | { kind: "persona" | "dialogueExamples"; virtual: boolean; markers: string[] };

/**
 * 對話記錄之前的版面，跟伺服器組前綴同一套規則：自訂條目照排序（停用、不支援的也照樣列出）；
 * 開著的玩家／角色 marker 畫「角色與玩家設定」，相鄰的併成一列；開著的對話示例 marker 畫一列。
 * 缺席的材料找錨點：ST 預設順序裡前面最近、伺服器有收進前綴的條目之後；沒有就後面最近的之前；
 * 都沒有就放在最後（角色、玩家、範例）。錨點只看伺服器收的：開著的，而且 inPrefix 說收（不支援、被移到對話記錄之後的不算）。
 */
export function prefixLayout(doc: PresetDocument, inPrefix: (id: string) => boolean = () => true): PrefixRow[] {
  const rows = entryRows(doc);
  const history = rows.findIndex((r) => r.identifier === HISTORY);
  const before = history < 0 ? rows : rows.slice(0, history);
  const blocks = before.filter((r) => r.enabled && (isFramework(r.identifier) || inPrefix(r.identifier))).map((r) => r.identifier);
  const emitted = new Set(blocks.filter((id) => PERSONA_IDS.has(id) || id === EXAMPLES_ID));
  const placedBefore = new Map<string, string[]>(), placedAfter = new Map<string, string[]>();
  const tail: string[] = [];
  for (const m of ["personaDescription", "charDescription", EXAMPLES_ID]) {
    if (emitted.has(m)) continue;
    const rank = ST_DEFAULT_ORDER.indexOf(m);
    const earlier = ST_DEFAULT_ORDER.slice(0, rank).reverse().find((id) => blocks.includes(id));
    const later = earlier ? undefined : ST_DEFAULT_ORDER.slice(rank + 1).find((id) => blocks.includes(id));
    if (earlier) placedAfter.set(earlier, [...(placedAfter.get(earlier) ?? []), m]);
    else if (later) placedBefore.set(later, [...(placedBefore.get(later) ?? []), m]);
    else tail.push(m);
  }
  const out: PrefixRow[] = [];
  const material = (m: string, virtual: boolean) => {
    const kind = m === EXAMPLES_ID ? "dialogueExamples" : "persona";
    const prev = out[out.length - 1];
    if (kind === "persona" && prev?.kind === "persona") { prev.markers.push(m); prev.virtual &&= virtual; return; }
    out.push({ kind, virtual, markers: [m] });
  };
  for (const r of before) {
    const id = r.identifier;
    for (const m of placedBefore.get(id) ?? []) material(m, true);
    if (!isFramework(id)) out.push({ kind: "entry", id });
    else if (emitted.has(id) && r.enabled) material(id, false);
    for (const m of placedAfter.get(id) ?? []) material(m, true);
  }
  for (const m of ["charDescription", "personaDescription", EXAMPLES_ID]) if (tail.includes(m)) material(m, true);
  return out;
}

/**
 * 一區照送出順序的「一步」：每條自訂條目一步；開著的玩家／角色 marker 相鄰的合成一步，對話示例一步。
 * 空槽 marker、停用的 marker 與伺服器補位的列都不算（補位的列黏著錨點，跨過錨點就跨過它）。
 */
function stepsOf(order: StOrderEntry[], side: "before" | "after"): string[][] {
  const history = order.findIndex((o) => o.identifier === HISTORY);
  const from = side === "before" ? 0 : history + 1;
  const to = side === "before" ? (history < 0 ? order.length : history) : history < 0 ? from : order.length;
  const steps: string[][] = [];
  let persona: string[] | null = null;
  for (let i = from; i < to; i++) {
    const { identifier: id, enabled } = order[i]!;
    if (PERSONA_IDS.has(id) && enabled !== false) { if (!persona) { persona = []; steps.push(persona); } persona.push(id); continue; }
    if (isFramework(id)) { if (id === EXAMPLES_ID && enabled !== false) { persona = null; steps.push([id]); } continue; }
    persona = null;
    steps.push([id]);
  }
  return steps;
}

/** 上移／下移一步要跨過的那一步（一條自訂條目或一列鎖定的設定）；到一區頂端或對話記錄前最後一格就沒有。 */
function neighbourStep(order: StOrderEntry[], id: string, dir: -1 | 1): string[] | null {
  if (isFramework(id)) return null;
  const at = order.findIndex((o) => o.identifier === id);
  if (at < 0) return null;
  const history = order.findIndex((o) => o.identifier === HISTORY);
  const steps = stepsOf(order, history >= 0 && at > history ? "after" : "before");
  const mine = steps.findIndex((st) => st.length === 1 && st[0] === id);
  return mine < 0 ? null : steps[mine + dir] ?? null;
}

/** 上移／下移按鈕能不能按：跟 moveEntry 實際會不會動同一個判斷。 */
export function canMoveEntry(doc: PresetDocument, id: string, dir: -1 | 1): boolean {
  return !!neighbourStep(orderOf(doc), id, dir);
}

/** 上移／下移一步：跨過一條自訂條目或一列「角色與玩家設定」，不跨聊天歷史。框架條目本身不動。 */
export function moveEntry(doc: PresetDocument, id: string, dir: -1 | 1): boolean {
  const order = orderOf(doc);
  const other = neighbourStep(order, id, dir);
  if (!other) return false;
  const [entry] = order.splice(order.findIndex((o) => o.identifier === id), 1);
  const anchor = order.findIndex((o) => o.identifier === (dir < 0 ? other[0] : other[other.length - 1]));
  order.splice(dir < 0 ? anchor : anchor + 1, 0, entry!);
  return true;
}

/** 條目落在哪一段：最後一份玩家／角色材料（含伺服器補位的）之前、之後（對話記錄之前），或對話記錄之後。框架條目回 null。 */
export function entryPlace(doc: PresetDocument, id: string, inPrefix?: (id: string) => boolean): "beforePersona" | "afterPersona" | "after" | null {
  if (isFramework(id)) return null;
  const order = orderOf(doc);
  const at = order.findIndex((o) => o.identifier === id);
  if (at < 0) return null;
  const history = order.findIndex((o) => o.identifier === HISTORY);
  if (history >= 0 && at > history) return "after";
  const layout = prefixLayout(doc, inPrefix);
  const mine = layout.findIndex((r) => r.kind === "entry" && r.id === id);
  let last = -1;
  layout.forEach((r, i) => { if (r.kind === "persona") last = i; });
  return mine >= 0 && mine < last ? "beforePersona" : "afterPersona";
}

export function detachEntry(doc: PresetDocument, id: string): boolean {
  if (isFramework(id)) return false;
  const order = orderOf(doc);
  const at = order.findIndex((o) => o.identifier === id);
  if (at < 0) return false;
  order.splice(at, 1);
  return true;
}

/** 插回排序：固定區放在聊天歷史前面，生成前區放在最後。插回來的條目是開著的。 */
export function insertEntry(doc: PresetDocument, id: string, slot: "P" | "S"): boolean {
  const order = orderOf(doc);
  if (!findPrompt(doc, id) || isFramework(id) || order.some((o) => o.identifier === id)) return false;
  const history = order.findIndex((o) => o.identifier === HISTORY);
  const at = slot === "P" && history >= 0 ? history : order.length;
  order.splice(at, 0, { identifier: id, enabled: true });
  return true;
}

/** 換到聊天歷史之前或之後：整個排序項目搬過去（來源的開關與其他欄位照舊），排在那一區的最後。 */
export function moveToSide(doc: PresetDocument, id: string, side: "before" | "after"): boolean {
  if (isFramework(id)) return false;
  const order = orderOf(doc);
  const at = order.findIndex((o) => o.identifier === id);
  if (at < 0) return false;
  const [entry] = order.splice(at, 1);
  const history = order.findIndex((o) => o.identifier === HISTORY);
  order.splice(side === "before" && history >= 0 ? history : order.length, 0, entry!);
  return true;
}

/**
 * 拖曳排序的落點：放到某條自訂條目前面，或放到一區（聊天歷史之前／之後）的最後面。
 * 可以越過框架條目與聊天歷史；框架條目本身拖不動。放回原處回 false，不算改動。
 */
export type DropTarget = { beforeId: string } | { side: "before" | "after" };
export function moveEntryTo(doc: PresetDocument, id: string, target: DropTarget): boolean {
  if (isFramework(id)) return false;
  const order = orderOf(doc);
  const from = order.findIndex((o) => o.identifier === id);
  if (from < 0) return false;
  const before = order.map((o) => o.identifier).join("\n");
  const [entry] = order.splice(from, 1);
  let at: number;
  if ("beforeId" in target) {
    at = order.findIndex((o) => o.identifier === target.beforeId);
  } else if (target.side === "after") {
    at = order.length;
  } else {
    // 之前區的最後面＝聊天歷史正前方（清單最後那列「世界書、對話記錄與記憶」之前）
    const history = order.findIndex((o) => o.identifier === HISTORY);
    at = history < 0 ? order.length : history;
  }
  if (at < 0) { order.splice(from, 0, entry!); return false; }
  order.splice(at, 0, entry!);
  return order.map((o) => o.identifier).join("\n") !== before;
}

function newIdentifier(doc: PresetDocument): string {
  const taken = new Set(promptsOf(doc.st).map((p) => p.identifier));
  let id = crypto.randomUUID();
  while (taken.has(id)) id = crypto.randomUUID();
  return id;
}

export function addEntry(doc: PresetDocument, init: { name: string; slot: "P" | "S"; content?: string }): string {
  const identifier = newIdentifier(doc);
  promptsOf(doc.st).push({ identifier, name: init.name, role: "system", content: init.content ?? "", injection_position: 0 });
  insertEntry(doc, identifier, init.slot);
  return identifier;
}

/** 複製一條自訂條目，放在原條目後面。 */
export function duplicateEntry(doc: PresetDocument, id: string, name: string): string | null {
  const source = findPrompt(doc, id);
  if (!source || isFramework(id)) return null;
  const identifier = newIdentifier(doc);
  const copy: StPrompt = { ...structuredClone(source), identifier, name };
  delete copy.system_prompt;
  const prompts = promptsOf(doc.st);
  prompts.splice(prompts.indexOf(source) + 1, 0, copy);
  const order = orderOf(doc);
  const at = order.findIndex((o) => o.identifier === id);
  if (at >= 0) order.splice(at + 1, 0, { identifier, enabled: order[at]!.enabled !== false });
  return identifier;
}

/** 只刪沒有任何一組排序在用的條目；另一組排序還用著的話，刪了它那組會懸空。 */
export function canDeleteEntry(doc: PresetDocument, id: string): boolean {
  if (isFramework(id)) return false;
  const st = doc.st;
  const orders: StOrderEntry[][] = isPromptPack(st)
    ? [orderOf(doc)]
    : ((st.prompt_order ?? []) as { order?: StOrderEntry[] }[]).map((p) => p.order ?? []);
  return !orders.some((order) => order.some((o) => o.identifier === id));
}

export function deleteEntry(doc: PresetDocument, id: string): boolean {
  if (!canDeleteEntry(doc, id)) return false;
  const st = doc.st;
  const prompts = promptsOf(st);
  const at = prompts.findIndex((p) => p.identifier === id);
  if (at < 0) return false;
  prompts.splice(at, 1);
  // 上游只收指向現有條目的選擇：一起拿掉，不然整份存不進去
  doc.selection.excludedEntryIds = doc.selection.excludedEntryIds.filter((x) => x !== id);
  doc.selection.acceptedAdaptationIds = doc.selection.acceptedAdaptationIds.filter((x) => x !== adaptationId(id));
  return true;
}

/**
 * 排序回到上次儲存的樣子。之後新增的條目接在各自那一區的最後；
 * 開關照現在的狀態，上次儲存後被移出的條目照當時的狀態插回。
 */
export function restoreOrder(doc: PresetDocument, saved: PresetDocument): void {
  const order = orderOf(doc);
  const now = new Map(order.map((o) => [o.identifier, o]));
  const exists = new Set(promptsOf(doc.st).map((p) => p.identifier));
  const before = entryRows(doc).filter((r) => r.side === "before").map((r) => r.identifier);
  const restored = orderOf(saved).filter((o) => exists.has(o.identifier)).map((o) => ({ ...o, enabled: now.get(o.identifier)?.enabled ?? o.enabled }));
  const kept = new Set(restored.map((o) => o.identifier));
  const added = order.filter((o) => !kept.has(o.identifier));
  const history = restored.findIndex((o) => o.identifier === HISTORY);
  const early = added.filter((o) => before.includes(o.identifier));
  const late = added.filter((o) => !before.includes(o.identifier));
  const at = history >= 0 ? history : restored.length;
  order.splice(0, order.length, ...restored.slice(0, at), ...early, ...restored.slice(at), ...late);
}

export function paramState(doc: PresetDocument, key: ParamKey): { value: unknown; adopted: boolean } {
  const value = doc.st[key];
  return { value, adopted: value !== undefined && !doc.selection.excludedFields.includes(key) };
}

/** 不採用＝沿用模型設定：記進 excludedFields，來源值留著，匯出回 ST 時還在。 */
export function setParamAdopted(doc: PresetDocument, key: ParamKey, adopted: boolean): void {
  const fields = doc.selection.excludedFields.filter((f) => f !== key);
  if (!adopted) fields.push(key);
  doc.selection.excludedFields = fields;
}

export function setParamValue(doc: PresetDocument, key: ParamKey, value: number | string): void {
  doc.st[key] = value;
  setParamAdopted(doc, key, true);
}

/** 服務端要的移位確認 ID：這條帶有當輪內容，從固定區移到生成前區才能用。 */
export const adaptationId = (id: string) => `${id}:move_to_suffix`;

export function setAdaptation(doc: PresetDocument, id: string, accepted: boolean): void {
  const key = adaptationId(id);
  const ids = doc.selection.acceptedAdaptationIds.filter((a) => a !== key);
  if (accepted) ids.push(key);
  doc.selection.acceptedAdaptationIds = ids;
}

/**
 * 新建的原生預設：一條空白的主要指示，加上 ST 預設排序裡的框架佔位（名字照 ST 原文，
 * 匯出回 ST 時看起來跟 ST 自己的一樣；畫面上的名字另外翻譯）。
 *
 * 只用 Harbor 對本站預設收的欄位（條目 identifier／name／role／content／marker／injection_position、
 * 最外層 prompts／prompt_order／temperature／top_p）：ST 自己的 system_prompt 這類欄位帶上去整份會被拒
 * （2026-10-29 正式站新建 422）。
 */
export function newDocument(mainName: string): PresetDocument {
  const markers: [string, string][] = [
    ["worldInfoBefore", "World Info (before)"], ["personaDescription", "Persona Description"],
    ["charDescription", "Char Description"], ["charPersonality", "Char Personality"], ["scenario", "Scenario"],
    ["worldInfoAfter", "World Info (after)"], ["dialogueExamples", "Chat Examples"], ["chatHistory", "Chat History"],
  ];
  const prompts: StPrompt[] = [
    { identifier: "main", name: mainName, role: "system", content: "", injection_position: 0 },
    ...markers.map(([identifier, name]) => ({ identifier, name, marker: true })),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    st: { prompts, prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }] },
    selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
  };
}

/**
 * Harbor 對本站寫的預設可執行的巨集只有 {{char}}、{{user}}、{{lastUserMessage}}，字一模一樣、括號成對
 * （對照 server 的 executableMacros）。其他寫法 analyze 會標「不支援」，存檔整份被拒。
 */
export function nativeMacrosValid(text: string): boolean {
  let s = text;
  for (;;) {
    const i = s.indexOf("{{");
    if (i < 0) return !s.includes("}}");
    if (s.slice(0, i).includes("}}")) return false;
    const j = s.indexOf("}}", i + 2);
    if (j < 0) return false;
    if (!["char", "user", "lastUserMessage"].includes(s.slice(i + 2, j))) return false;
    s = s.slice(j + 2);
  }
}

const NATIVE_RANGE: Record<string, number> = { temperature: 2, top_p: 1 };

/**
 * 本站寫的預設存檔前會被上游擋下的地方：所有自訂條目（開著、關著、移出排序的都算——上游每條都查）
 * 身分不是系統、不在相對位置或巨集不合；以及最外層的 temperature／top_p 不在範圍內（不管有沒有採用）。
 * 回傳條目的 identifier 或參數鍵。
 */
export function nativeProblems(doc: PresetDocument): string[] {
  const out: string[] = [];
  for (const p of promptsOf(doc.st)) {
    if (isFramework(p.identifier)) continue;
    if (p.role !== "system" || (p.injection_position ?? 0) !== 0 || !nativeMacrosValid(p.content ?? "")) out.push(p.identifier);
  }
  for (const [key, max] of Object.entries(NATIVE_RANGE)) {
    if (!(key in doc.st)) continue;
    const v = doc.st[key];
    if (typeof v !== "number" || v < 0 || v > max) out.push(key);
  }
  return out;
}

/** 本站寫的預設改回沿用模型設定：沒有來源檔要保留，值直接拿掉（留著的值上游一樣會查）。 */
export function clearParam(doc: PresetDocument, key: ParamKey): void {
  delete doc.st[key];
  doc.selection.excludedFields = doc.selection.excludedFields.filter((f) => f !== key);
}
