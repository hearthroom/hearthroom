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
}
export interface PresetDocument { schemaVersion: string; st: StDocument; selection: PresetSelection }

/** P 固定區（歷史之前）、F 由框架提供、S 生成前（歷史之後）、D 插在歷史中間（不執行）。 */
export type Slot = "P" | "F" | "S" | "D";
/** side：在排序裡位於聊天歷史之前或之後（插在歷史中間的條目也照這個歸區顯示） */
export interface EntryRow { identifier: string; prompt: StPrompt; enabled: boolean; slot: Slot; side: "before" | "after" }

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
    return [{ identifier: o.identifier, prompt, enabled, slot, side }];
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
export function moveEntry(doc: PresetDocument, id: string, dir: -1 | 1): boolean {
  const rows = entryRows(doc);
  const row = rows.find((r) => r.identifier === id);
  if (!row || row.slot === "F") return false;
  const peers = rows.filter((r) => r.slot === row.slot);
  const target = peers[peers.indexOf(row) + dir];
  if (!target) return false;
  const order = orderOf(doc);
  const a = order.findIndex((o) => o.identifier === id);
  const b = order.findIndex((o) => o.identifier === target.identifier);
  [order[a], order[b]] = [order[b]!, order[a]!];
  return true;
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
export function deleteEntry(doc: PresetDocument, id: string): boolean {
  if (isFramework(id)) return false;
  const st = doc.st;
  const orders: StOrderEntry[][] = isPromptPack(st)
    ? [orderOf(doc)]
    : ((st.prompt_order ?? []) as { order?: StOrderEntry[] }[]).map((p) => p.order ?? []);
  if (orders.some((order) => order.some((o) => o.identifier === id))) return false;
  const prompts = promptsOf(st);
  const at = prompts.findIndex((p) => p.identifier === id);
  if (at < 0) return false;
  prompts.splice(at, 1);
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
 */
export function newDocument(mainName: string): PresetDocument {
  const markers: [string, string][] = [
    ["worldInfoBefore", "World Info (before)"], ["personaDescription", "Persona Description"],
    ["charDescription", "Char Description"], ["charPersonality", "Char Personality"], ["scenario", "Scenario"],
    ["worldInfoAfter", "World Info (after)"], ["dialogueExamples", "Chat Examples"], ["chatHistory", "Chat History"],
  ];
  const prompts: StPrompt[] = [
    { identifier: "main", name: mainName, role: "system", content: "", system_prompt: true, injection_position: 0 },
    ...markers.map(([identifier, name]) => ({ identifier, name, marker: true, system_prompt: true })),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    st: { prompts, prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }] },
    selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
  };
}
