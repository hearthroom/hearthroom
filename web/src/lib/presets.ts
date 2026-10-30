/**
 * 我的預設：上游 /open/v1/presets 與 /preset-imports。私人資產，只有本人看得到；
 * 這裡不碰綁定（哪張卡、哪段對話用哪個版本），那在遊玩畫布裡選。
 *
 * 會寫入的請求都帶 Idempotency-Key。鍵由呼叫端為「一次操作」產生一次，網路斷掉重送時沿用
 * 同一把，上游就回原本那張收據，不會多建一個版本、多佔一個名額。
 */
import { UPSTREAM_API } from "./config";
import { ApiError, authHeaders, json as upstreamJson } from "./api";
import { i18n } from "./i18n";
import { entryRows, isPromptPack, profilesOf, type PresetDocument, type PresetSelection, type StDocument } from "./st-preset";

/** relocated：上游自動把位置調到最近的穩定位置，照常使用、不擋存檔；needs_adjustment 只剩舊版本會出現 */
export type UiStatus = "needs_adjustment" | "relocated" | "unsupported";
export type PresetAction = "delete" | "archive";

export interface PresetSummary {
  id: string;
  title: string;
  headRevisionId: string;
  version: number;
  /** native：在本站寫的；imported：從 ST 檔匯入的 */
  sourceKind: string;
  archived: boolean;
  recommendedModels: string[];
  createdAt: string;
  updatedAt: string;
  /** 上游依綁定與發布紀錄決定能刪還是只能封存；畫面照這個出選項，不自己猜 */
  allowedActions: PresetAction[];
  bindingCount: number;
}
export interface RevisionSummary { revisionId: string; version: number; title: string; createdAt: string; enabledEntryCount: number }
export interface PresetDetail extends PresetSummary { revisions: RevisionSummary[] }
export interface PresetList { items: PresetSummary[]; nextCursor: string; quota: { used: number; limit: number; archived: number } }

export interface CompatibilityEntry {
  identifier: string;
  enabled: boolean;
  frameworkOwned: boolean;
  targetSlot?: string;
  /** 空＝可以直接用，不標示 */
  uiStatus?: UiStatus;
  reasonCodes: string[];
  availableAdaptationIds: string[];
  /** 這條在 ST 還有、但本站不執行的設定（ST 欄位名），匯出時原樣保留 */
  inertSettings: string[];
  adaptationId?: string;
}
export interface CompatibilityField { path: string; uiStatus?: UiStatus; reasonCodes: string[]; inertSettings: string[] }
/** 舊版本的報告沒有這一項，當兩者都是 false */
/** 綺夢社自己的回覆工具，上游原樣給（開關關著也給）；名稱、參數、示例是協定文字，不翻譯 */
export interface ReplyTool { name: string; description: string; parameters: { properties?: Record<string, { description?: string }> } & Record<string, unknown>; example: { name: string; arguments: Record<string, unknown> } }
export interface ToolReplyReport { enabled: boolean; externalToolBindingsDetected: boolean; tool?: ReplyTool }
export interface Compatibility { compilerVersion: string; entries: CompatibilityEntry[]; fields: CompatibilityField[]; reviewRequired: boolean; toolReply?: ToolReplyReport }

export interface PresetRevision {
  revisionId: string;
  presetId: string;
  version: number;
  document: PresetDocument;
  sourceKind: string;
  compilerVersion: string;
  contentHash: string;
  recommendedModels: string[];
  createdAt: string;
}
export interface WriteReceipt { presetId: string; revisionId: string; version: number; disposition?: "deleted" | "archived" }
export interface ImportPreview {
  previewId: string;
  version: number;
  expiresAt: string;
  sourceHash: string;
  selectionDigest: string;
  document: PresetDocument;
  report: Compatibility;
}

export const PRESET_LIMIT_BYTES = 1024 * 1024;

/** 預設數量上限；清單回來時以上游給的為準，錯誤句子裡的數字跟著它。 */
let quotaLimit = 50;
const LIMIT_TEXT = "1 MB";

/** 上游的細碼（reason）對到文案的句子；同一句可以涵蓋好幾個碼。 */
const REASON_KEY: Record<string, string> = {
  preset_source_too_large: "preset.error.tooLarge",
  preset_invalid_json: "preset.error.json",
  preset_invalid_utf8: "preset.error.utf8",
  preset_invalid_object: "preset.error.format", preset_invalid_input: "preset.error.format",
  preset_expected_object: "preset.error.format", preset_schema_invalid: "preset.error.format",
  preset_pack_invalid: "preset.error.pack", preset_native_pack_invalid: "preset.error.pack",
  preset_invalid_prompt: "preset.error.prompt", preset_invalid_prompts: "preset.error.prompt",
  preset_duplicate_identifier: "preset.error.duplicate",
  preset_invalid_order: "preset.error.order", preset_invalid_order_reference: "preset.error.order",
  preset_profile_not_found: "preset.error.profileNotFound",
  preset_selection_invalid: "preset.error.selection",
  preset_adjustment_required: "preset.error.adjustment",
  preset_macro_invalid: "preset.error.macro",
  preset_native_field_unsupported: "preset.error.native", preset_native_entry_unsupported: "preset.error.native",
  preset_model_setting_unsupported: "preset.error.modelSetting",
  preset_revision_conflict: "preset.error.revisionConflict",
  preset_idempotency_conflict: "preset.error.idempotency",
  preset_archived: "preset.error.archived",
  operation_active: "preset.error.busy",
};
/** 沒有細碼時看碼本身；這幾個在預設頁上有比站上通用句更準的說法。 */
const CODE_KEY: Record<string, string> = {
  invalid_request: "preset.error.invalidRequest",
  preset_profile_required: "preset.error.profileRequired",
  preset_preview_expired: "preset.import.expired",
  preset_style_locked: "preset.error.styleLocked",
  quota_exceeded: "preset.error.quota",
  insufficient_scope: "preset.error.scope",
  not_found: "preset.error.notFound",
  temporarily_unavailable: "preset.error.unavailable",
};

export function presetErrorText(err: ApiError): string | null {
  const key = REASON_KEY[err.reason] ?? (err.status === 413 ? "preset.error.tooLarge" : CODE_KEY[err.code]);
  return key ? i18n.global.t(key, { limit: key === "preset.error.quota" ? quotaLimit : LIMIT_TEXT }) : null;
}

async function json<T>(res: Response): Promise<T> {
  try {
    return await upstreamJson<T>(res);
  } catch (err) {
    const text = err instanceof ApiError ? presetErrorText(err) : null;
    if (!text) throw err;
    const e = err as ApiError;
    throw new ApiError(e.status, text, e.code, e.reviewLength, e.reason);
  }
}

/** 寫入送出去卻沒收到回應（網路斷了）：結果未知，不是失敗。呼叫端用同一把冪等鍵重送就能拿回原本的收據。 */
export const resultUnknown = (err: unknown) => !(err instanceof ApiError) && err instanceof TypeError;

const base = `${UPSTREAM_API}/open/v1`;
const send = (path: string, token: string, body: unknown, key?: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token), ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: authHeaders(token), cache: "no-store" });
const id = (s: string) => encodeURIComponent(s);

export async function listPresets(token: string, cursor = ""): Promise<PresetList> {
  const q = new URLSearchParams({ limit: "50" });
  if (cursor) q.set("cursor", cursor);
  const out = await json<PresetList>(await get(`/presets?${q}`, token));
  if (out.quota?.limit) quotaLimit = out.quota.limit;
  return out;
}

export async function fetchPreset(token: string, presetId: string): Promise<PresetDetail> {
  return json<PresetDetail>(await get(`/presets/${id(presetId)}`, token));
}

export async function fetchRevision(token: string, presetId: string, revisionId: string): Promise<{ revision: PresetRevision; compatibility: Compatibility }> {
  return json(await get(`/presets/${id(presetId)}/revisions/${id(revisionId)}`, token));
}

/** 不建版本，只回這份草稿的相容判定；編輯中用來即時標「需調整」「不支援」。 */
export async function analyzePreset(token: string, document: PresetDocument): Promise<Compatibility> {
  const out = await json<{ compatibility?: Compatibility } & Partial<Compatibility>>(await send("/presets/analyze", token, { document }));
  return out.compatibility ?? (out as Compatibility);
}

export interface PresetWrite { title: string; document: PresetDocument; recommendedModels: string[] }

export async function createPreset(token: string, input: PresetWrite, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send("/presets", token, input, key));
}

/** 存成新版本。expectedVersion 是開始編輯時讀到的版本；別的分頁先存了就回 409，草稿留著。 */
export async function revisePreset(token: string, presetId: string, input: PresetWrite & { expectedVersion: number }, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/presets/${id(presetId)}/revisions`, token, input, key));
}

/** 回 disposition：deleted 真的刪了；archived 是還有對話在用或發布過，只封存，原對話照常。 */
export async function deletePreset(token: string, presetId: string, expectedVersion: number, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/presets/${id(presetId)}/delete`, token, { expectedVersion }, key));
}

export async function archivePreset(token: string, presetId: string, expectedVersion: number, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/presets/${id(presetId)}/archive`, token, { expectedVersion }, key));
}

export async function previewImport(token: string, file: File, profileId: number | null): Promise<ImportPreview> {
  const form = new FormData();
  form.set("file", file);
  if (profileId !== null) form.set("profileId", String(profileId));
  return json<ImportPreview>(await fetch(`${base}/preset-imports/preview`, { method: "POST", headers: authHeaders(token), body: form }));
}

export async function updateImportSelection(token: string, previewId: string, expectedPreviewVersion: number, selection: PresetSelection): Promise<ImportPreview> {
  return json<ImportPreview>(await send(`/preset-imports/${id(previewId)}/selection`, token, { expectedPreviewVersion, selection }));
}

export async function confirmImport(
  token: string, previewId: string,
  input: { expectedPreviewVersion: number; selectionDigest: string; title: string; recommendedModels: string[] }, key: string,
): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/preset-imports/${id(previewId)}/confirm`, token, input, key));
}

/** 下載 ST 格式的預設檔。檔名用上游給的；沒給就用預設名稱。 */
export async function exportRevision(token: string, presetId: string, revisionId: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const res = await get(`/presets/${id(presetId)}/revisions/${id(revisionId)}/export`, token);
  if (!res.ok) await json(res);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const named = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return { blob: await res.blob(), filename: named ? decodeURIComponent(named) : `${fallbackName}.json` };
}

/** 一組排序設定的摘要：多組時讓玩家分得出是哪一組（條目數、前三條自訂條目的名稱）。 */
export interface LocalProfile { id: number; count: number; names: string[]; more: boolean }

/** 選檔後先在本機讀出排序設定，有多組就讓玩家選，不替他猜；上游一樣會再驗一次。 */
export async function readLocalProfiles(file: File): Promise<{ ok: true; profiles: LocalProfile[] } | { ok: false; reason: "too_large" | "not_json" | "not_preset" }> {
  if (file.size > PRESET_LIMIT_BYTES) return { ok: false, reason: "too_large" };
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { return { ok: false, reason: "not_json" }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "not_preset" };
  const st = parsed as StDocument;
  const prompts = isPromptPack(st) ? (st.data as StDocument).prompts : st.prompts;
  if (!Array.isArray(prompts)) return { ok: false, reason: "not_preset" };
  // 有條目卻沒有任何排序設定：讀不出要用哪些、怎麼排
  const ids = profilesOf(st);
  if (!ids.length) return { ok: false, reason: "not_preset" };
  const profiles = ids.map((id) => {
    const doc = { schemaVersion: "", st: structuredClone(st), selection: { profileId: id, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] } };
    const custom = entryRows(doc).filter((r) => r.slot !== "F");
    return { id, count: custom.length, names: custom.slice(0, 3).map((r) => r.prompt.name || r.identifier), more: custom.length > 3 };
  });
  return { ok: true, profiles };
}

/**
 * 另存副本：上游從來源的最新版本整份複製（含匯入的原檔與來源種類），建成一個新的私人預設。
 * 原本的預設和正在用它的對話都不變。不能在前端讀出來再新建：匯入的原檔不在前端手上。
 */
export async function copyPreset(token: string, presetId: string, title: string, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/presets/${id(presetId)}/copy`, token, { title }, key));
}

export interface ModelOption { value: string; label: string }

/**
 * 「測試過的模型」選單：存模型目錄裡穩定的 variant 代碼，顯示站上公開的模型名稱。
 * 只是標示，不限制能用在哪個模型；目錄裡已經沒有的舊代碼照樣留著。
 */
export async function fetchModelOptions(token: string): Promise<ModelOption[]> {
  type Variant = { value?: string; name?: string };
  const groups = await json<{ families?: { family?: string; variants?: Variant[] }[] }[]>(await get("/models", token));
  const seen = new Map<string, ModelOption>();
  for (const family of groups.flatMap((g) => g.families ?? [])) {
    const variants = (family.variants ?? []).filter((v) => v.value);
    for (const v of variants) {
      if (seen.has(v.value!)) continue;
      const label = variants.length > 1 && v.name ? `${family.family ?? ""} · ${v.name}` : family.family || v.name || v.value!;
      seen.set(v.value!, { value: v.value!, label });
    }
  }
  return [...seen.values()];
}
