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
  /** 分享（P2）。舊上游沒有這幾項：當成私人、沒被下架 */
  visibility?: "private" | "public";
  publishedAt?: string | null;
  attribution?: string;
  /** 平台下架了：作者看得到這個標示，不能再公開 */
  removed?: boolean;
}
export interface RevisionSummary { revisionId: string; version: number; title: string; createdAt: string; enabledEntryCount: number }
export interface PresetDetail extends PresetSummary { revisions: RevisionSummary[] }
export interface PresetList {
  items: PresetSummary[]; nextCursor: string; quota: { used: number; limit: number; archived: number };
  /** 公開鈕旁那句聲明的版本；公開時原樣送回，上游據此記下作者看到的是哪一版 */
  declarationVersion?: string;
}

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
  preset_removed: "preset.share.takenDown.note",
  preset_declaration_changed: "preset.share.error.declarationChanged",
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

/** 模型目錄的兩層：系列（catalog 的 group）與它底下的模型（family）。線路（variants）不進「測試過的模型」。 */
export interface ModelCatalogGroup { group: string; families: string[] }

/**
 * 「測試過的模型」選單的資料：存 `series:<系列>` 或 `model:<模型>`，名稱照目錄原字。
 * 只是標示，不限制能用在哪個模型；目錄裡已經沒有的舊值照樣留著。
 */
export async function fetchModelCatalog(token: string): Promise<ModelCatalogGroup[]> {
  const raw = await json<{ group?: string; families?: { family?: string }[] }[]>(await get("/models", token));
  const out = new Map<string, Set<string>>();
  for (const g of raw) {
    if (!g.group) continue;
    const families = out.get(g.group) ?? new Set<string>();
    for (const f of g.families ?? []) if (f.family) families.add(f.family);
    out.set(g.group, families);
  }
  return [...out].map(([group, families]) => ({ group, families: [...families] }));
}

/* ---- 分享（P2）：公開、公開列表、喜愛與用過、檢舉 ---------------------------------------- */

/** 公開列表與「喜愛與用過」共用的一列。作者用公開身分（authorNumId），不回帳號 UUID。 */
export interface PresetLibraryItem {
  presetId: string;
  title: string;
  authorName: string;
  authorNumId: number;
  authorAvatar: string;
  attribution: string;
  /** 作者測試過的模型代碼；空＝通用 */
  recommendedModels: string[];
  enabledEntryCount: number;
  /** 近 7 天作者以外實際玩過的不同玩家數 */
  usesLast7d: number;
  publishedAt: string | null;
  updatedAt: string;
  favorited: boolean;
  lastAppliedAt: string | null;
  /** false：作者改回私人、刪了，或平台下架；喜愛與用過裡照常可用 */
  listed: boolean;
  mine: boolean;
}
export interface PresetLibraryList { items: PresetLibraryItem[] }
export interface PresetLibraryDetail {
  item: PresetLibraryItem;
  revision: PresetRevision;
  compatibility: Compatibility;
  /** 這份預設有設的取樣參數（只有設了的鍵），數值原樣 */
  parameters: Record<string, number>;
  reportedByMe: boolean;
}
export const REPORT_REASONS = ["copyright", "inappropriate", "spam", "other"] as const;
export type PresetReportReason = (typeof REPORT_REASONS)[number];
/** 公開列表一頁幾筆；回來的筆數等於它，就還有下一頁 */
export const LIBRARY_PAGE = 20;

export interface PublishInput { expectedVersion: number; declaration: string; attribution: string; recommendedModels?: string[] }

/** 公開：不改內容。recommendedModels 不送就沿用原本的；送空陣列＝通用。 */
export async function publishPreset(token: string, presetId: string, input: PublishInput, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/presets/${id(presetId)}/publish`, token, input, key));
}

/** 改回私人：只離開公開列表與搜尋，用過或喜愛的人照常用。 */
export async function unpublishPreset(token: string, presetId: string, expectedVersion: number, key: string): Promise<WriteReceipt> {
  return json<WriteReceipt>(await send(`/presets/${id(presetId)}/unpublish`, token, { expectedVersion }, key));
}

/** model：all（全部）、general（沒標測試模型的）或模型代碼；排序由上游決定（近 7 天使用人數）。 */
export async function listPresetLibrary(token: string, opts: { model?: string; q?: string; offset?: number } = {}): Promise<PresetLibraryList> {
  const q = new URLSearchParams({ limit: String(LIBRARY_PAGE), offset: String(opts.offset ?? 0) });
  if (opts.model && opts.model !== "all") q.set("model", opts.model);
  if (opts.q?.trim()) q.set("q", opts.q.trim().slice(0, 64));
  return json<PresetLibraryList>(await get(`/preset-library?${q}`, token));
}

/** 我的「喜愛與用過」：喜愛的在前，接著用過的。自己的預設不在這裡。 */
export async function listPresetShelf(token: string, offset = 0): Promise<PresetLibraryList> {
  const q = new URLSearchParams({ limit: String(LIBRARY_PAGE), offset: String(offset) });
  return json<PresetLibraryList>(await get(`/preset-shelf?${q}`, token));
}

export async function fetchLibraryPreset(token: string, presetId: string): Promise<PresetLibraryDetail> {
  return json<PresetLibraryDetail>(await get(`/preset-library/${id(presetId)}`, token));
}

/** 冪等：送幾次都是同一個結果，不需要冪等鍵。 */
export async function favoritePreset(token: string, presetId: string, favorite: boolean): Promise<{ favorited: boolean }> {
  return json<{ favorited: boolean }>(await send(`/preset-library/${id(presetId)}/favorite`, token, { favorite }));
}

/** 同一人還沒處理的檢舉不重記，照樣回 reported。 */
export async function reportPreset(token: string, presetId: string, reason: PresetReportReason, detail: string): Promise<{ reported: boolean }> {
  return json<{ reported: boolean }>(await send(`/preset-library/${id(presetId)}/report`, token, detail ? { reason, detail } : { reason }));
}

/**
 * 「測試過的模型」存值的顯示名：`series:<系列>` 顯示成「<系列> 全系列」，`model:<模型>` 顯示模型名，
 * 目錄已經沒有的舊值照原字。跟選單（PresetModelPicker）的標籤同一個規則，列表與詳情不用先載入目錄。
 */
export function modelValueLabel(value: string): string {
  if (value.startsWith("series:")) return i18n.global.t("preset.models.series", { name: value.slice(7) });
  if (value.startsWith("model:")) return value.slice(6);
  return value;
}
