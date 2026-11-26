import { MAX_PLAYER_CONSTANT_CHARS, workshopResidentLimit } from "../../../shared/workshop-resident.mjs";
/**
 * 卡片工坊（擴充）的資料層：型別、請求與幾個畫面要用的純函式。
 *
 * 端點形狀照 docs studio/tasks/2026-11-13-card-workshop/interface-web.md（2026-11-14 議定），v2（2026-11-15）改成
 * 兩層：原卡作者的「作者 DLC」（世界書、正則、開場）與任何玩家的「玩家擴充」（只有世界書），都是發布即上架，
 * 沒有審核、申訴、分潤；契約見 server provider/docs/workshop-v2-api.md「v2 client DTO contract」。
 * 本站（/v1，Worker）管列表、詳情、版本、評論、我的擴充、發布／下架／放棄修改；
 * Provider（/open/v1/workshop）管加入與排序、字數與建議檔位、草稿、讀取作者開關；存作者開關與隱藏走本站。
 * 哪一層（kind）由伺服器依原卡作者身分判定，網頁只照著畫，從不送出。
 *
 * 網頁不自己判斷「分頁要不要出現」「這位玩家能不能加入」「建議用哪一檔」：這些都照伺服器回的欄位畫
 * （tabVisible、availability、usage-summary）。網頁唯一自己算的是編輯頁的常駐字數條，送審仍以伺服器為準。
 */
import { COMMUNITY_API } from "./config";
import { authHeaders, json } from "./api";
import { apiBaseOf, currentProvider } from "./provider";
import { currentSurface } from "./track";
import type { WorldbookEntryDraft } from "./role-draft";
import type { RegexRuleSet } from "./regex-rules";
import type { ConversationMods, ModAction, PrivateModBook, PrivateModEntry, UniversalMod, UniversalModChoice } from "./workshop-mods";

/** 內容類型；"display" 是正則（介面規則），字面沿用線上契約，畫面寫「正則」 */
export type WorkshopKind = "lore" | "display" | "opening";
/** 兩層：作者 DLC／玩家擴充 */
export type ExtensionLayer = "dlc" | "lorebook";
export const WORKSHOP_KINDS: WorkshopKind[] = ["lore", "display", "opening"];

export interface ExtensionAuthor { handle: string | null; name: string; avatar?: string }
export interface ExtensionSummary {
  id: string; cardId: string; name: string; summary: string;
  /** 橫式 16:9；草稿可能沒有，畫面用名稱算出的底色代替 */
  coverUrl: string;
  author: ExtensionAuthor;
  joinCount: number;
  kind: ExtensionLayer;
  /** 世界書條數（玩家擴充格寫「世界書 N 條」）；舊回應沒有就只寫「世界書」 */
  loreCount?: number;
  /** 公開版號 vN；從未上架是 0 */
  version: number;
  updatedAt: number;
  kinds: WorkshopKind[];
  rating: string | null;
  /** 分級高於原卡：加入前要先確認年齡 */
  adult: boolean;
  joined?: boolean;
  /** 原作者看自己的卡時才有：玩家擴充是否被他隱藏 */
  ownerState?: OwnerState;
}
export type OwnerState = "visible" | "hidden";
export type WorkshopSort = "hot" | "new";

export interface CardWorkshopPage {
  tabVisible: boolean; allowNew: boolean; viewerIsOwner: boolean;
  total: number; page: number; hasMore: boolean;
  items: ExtensionSummary[];
}

export type Availability = "open" | "hidden" | "removed";
export interface ExtensionDetail extends ExtensionSummary {
  readme: string;
  commentCount: number;
  card: { id: string; num: number; name: string; avatarUrl?: string; roleId: string; provider?: string };
  contents: { loreCount: number; ruleCount: number; openingCount: number };
  residentChars: number;
  availability: Availability;
}
export interface ExtensionVersion { version: number; publishedAt: number | null; note: string }

export type MineStatus = "draft" | "live" | "live_changed";
export type PlayerShareState = "private" | "pending" | "displayed" | "unlisted";
export interface PlayerShare {
  state: PlayerShareState; allowed: boolean; everAllowed: boolean;
  draftRevision: number; generation: number; new: boolean; hasUpdate: boolean; joinCount: number;
}
export interface PlayerShareItem extends PlayerShare {
  workshopId: string; roleId: string; cardNumber: number; cardName: string; name: string; coverUrl: string;
  authorNumber: number; authorName?: string; entryCount: number; residentChars: number; updatedAt: number; closed: boolean;
}
export interface PlayerShareContent extends PlayerShare {
  workshopId: string; name: string; summary: string;
  entries: {
    id?: string; entryId?: string; name: string; content: string; keywords?: string[];
    isConstant?: boolean; mode?: "constant" | "triggered";
  }[];
}
export interface MineItem extends ExtensionSummary {
  card: { id: string; num: number; name: string; roleId: string };
  status: MineStatus;
  ownerState: OwnerState;
  /** 原卡作者關了這張卡的工坊：已發布的也暫停套用 */
  workshopClosed: boolean;
  playerShareState?: PlayerShareState;
}
export interface WorkshopCardChoice {
  cardId: string; num: number; name: string; avatarUrl?: string;
  author: { name: string }; roleId: string; allowNew: boolean;
  viewerIsOwner?: boolean;
}

/** 已加入清單多一種：原卡作者關了工坊（closed），加入與開關都保留，重新開啟就恢復 */
export type SelectionAvailability = Availability | "closed";
export interface SelectionItem {
  workshopId: string; enabled: boolean; name: string; coverUrl: string;
  kind?: ExtensionLayer;
  kinds: WorkshopKind[]; residentChars: number; availability: SelectionAvailability;
}
export interface Selection { revision: number; items: SelectionItem[] }

export interface UsageSummary {
  baseConstantChars: number;
  enabledWorkshopConstantChars: number;
  totalConstantChars: number;
  items: { workshopId: string; constantChars: number }[];
  currentContextTier: number | null; currentContextTokens: number | null;
  recommendedContextTier: number | null; recommendedContextTokens: number | null;
  currentTierSufficient: boolean;
  requestFits: boolean;
  highestAvailableTokens: number | null;
  recommendationReason: string;
}

export interface OwnerPolicyCounts { dlcPublished: number; dlcDrafts: number; lorebookPublished: number; lorebookDrafts: number; joinCount: number }
export interface OwnerPolicy {
  allowNew: boolean; everOpened?: boolean; revision: number;
  counts?: OwnerPolicyCounts;
  items: ExtensionSummary[];
}

export interface WorkshopOpening { mode: "greeting" | "page"; welcome: string; alternates: string[]; prologue: string[]; openingPage: string }
export interface LorePackDraft { id: string; name: string; description?: string; defaultEnabled: boolean }
export interface WorkshopDraft {
  workshopId: string; revision: number;
  kind: ExtensionLayer;
  playerShare?: PlayerShare;
  card: { roleId: string; cardId: string; num: number; name: string; ownerIsMe: boolean };
  name: string; summary: string; readme: string; coverUrl: string;
  rating: string | null; ratingAnswers: Record<string, unknown> | null;
  worldbook: WorldbookEntryDraft[];
  lorePacks?: LorePackDraft[];
  scriptCanSwitchPacks?: boolean;
  rules: RegexRuleSet;
  opening: WorkshopOpening;
  updateNote: string;
  published: { version: number } | null;
  changedSincePublish: boolean;
}
/** 玩家擴充不送 rules／opening（伺服器拒收非空的正則與開場）；作者 DLC 一律帶 */
export type DraftWrite = Pick<WorkshopDraft, "name" | "summary" | "readme" | "coverUrl" | "rating" | "ratingAnswers" | "worldbook" | "updateNote"> & Partial<Pick<WorkshopDraft, "rules" | "opening" | "lorePacks" | "scriptCanSwitchPacks">>;
export interface DraftError { code: string; actual?: number; max?: number; unit?: string }

// ---- 請求 ------------------------------------------------------------------

const site = (token?: string | null): Record<string, string> => ({ "X-From": currentSurface(), "X-Provider": currentProvider(), ...authHeaders(token ?? undefined) });

async function community<T>(path: string, token?: string | null, method = "GET", body?: unknown): Promise<T> {
  return json<T>(await fetch(COMMUNITY_API + path, {
    method, cache: "no-store",
    headers: { ...site(token), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
async function upstream<T>(path: string, token: string, body?: unknown): Promise<T> {
  // 工坊只在 Harbor：不管看的人目前選哪一家，都打 Harbor
  return json<T>(await fetch(apiBaseOf("harbor") + "/open/v1" + path, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: { ...authHeaders(token), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const text = s.toString();
  return text ? `?${text}` : "";
};

// 本站
export const fetchCardWorkshop = (cardId: string, opts: { sort: WorkshopSort; page: number }, token?: string | null) =>
  community<CardWorkshopPage>(`/cards/${encodeURIComponent(cardId)}/workshop${q({ sort: opts.sort, page: opts.page })}`, token);
export const fetchWorkshopsByIds = (ids: string[], token?: string | null) =>
  ids.length ? community<{ items: ExtensionSummary[] }>(`/workshops${q({ ids: ids.join(",") })}`, token) : Promise.resolve({ items: [] });
export const fetchWorkshop = (id: string, token?: string | null) => community<ExtensionDetail>(`/workshops/${encodeURIComponent(id)}`, token);
export const fetchWorkshopVersions = (id: string, page = 1, token?: string | null) =>
  community<{ items: ExtensionVersion[]; hasMore: boolean }>(`/workshops/${encodeURIComponent(id)}/versions${q({ page })}`, token);
export const fetchMyWorkshops = (token: string) => community<{ items: MineItem[] }>("/me/workshops", token);
/**
 * 發布／下架／放棄修改：同一個使用者意圖用同一個 operationId（重試沿用），版本對不上由伺服器回 stale。
 * 發布即上架；下架回到草稿；放棄修改回整份目前的草稿（已還原成線上版）。
 */
export interface PublishBody { expectedRevision: number; operationId: string }
export const publishWorkshop = (id: string, body: PublishBody, token: string) =>
  community<{ workshopId: string; releaseId: string; status: "published"; kind: ExtensionLayer; version: number }>(`/me/workshops/${encodeURIComponent(id)}/publish`, token, "POST", body);
export const unpublishWorkshop = (id: string, body: PublishBody, token: string) =>
  community<{ workshopId: string; status: "draft"; draftRevision: number }>(`/me/workshops/${encodeURIComponent(id)}/unpublish`, token, "POST", body);
export const discardWorkshopChanges = (id: string, body: PublishBody, token: string) =>
  community<WorkshopDraft>(`/me/workshops/${encodeURIComponent(id)}/discard-changes`, token, "POST", body);
export const fetchWorkshopCards = (query: string, token: string) =>
  community<{ items: WorkshopCardChoice[] }>(`/me/workshop-cards${q({ q: query.trim() })}`, token);

// Provider
export const fetchSelection = (roleId: string, token: string) => upstream<Selection>(`/workshop/selection${q({ roleId })}`, token);
export const installWorkshop = (roleId: string, workshopId: string, token: string) => upstream<Selection>("/workshop/install", token, { roleId, workshopId });
export const uninstallWorkshop = (roleId: string, workshopId: string, token: string) => upstream<Selection>("/workshop/uninstall", token, { roleId, workshopId });
export const saveSelection = (roleId: string, selection: Selection, token: string) =>
  upstream<Selection>("/workshop/selection/save", token, { roleId, expectedRevision: selection.revision, items: selection.items.map((i) => ({ workshopId: i.workshopId, enabled: i.enabled })) });
export const fetchUsageSummary = (roleId: string, token: string) => upstream<UsageSummary>(`/workshop/usage-summary${q({ roleId })}`, token);

const conversationModsPath = "/workshop/conversation/mods";
const privateModPath = "/workshop/conversation/private-lorebook";
export const fetchConversationMods = (
  conversationId: string, token: string, scope: { packWorkshopId?: string; trialWorkshopId?: string } = {},
) => upstream<ConversationMods>(conversationModsPath + q({ conversationId, packSummary: "1", ...scope }), token);
export const applyConversationMod = (conversationId: string, version: string, action: ModAction, token: string, trialWorkshopId?: string) =>
  upstream<ConversationMods>(conversationModsPath + q({ packSummary: "1", trialWorkshopId }), token, { conversationId, version, ...action });
export const fetchPrivateMod = (conversationId: string, token: string) =>
  upstream<PrivateModBook>(privateModPath + q({ conversationId }), token);
export const savePrivateMod = (conversationId: string, revision: string, entries: PrivateModEntry[], token: string) =>
  upstream<PrivateModBook>(privateModPath, token, { conversationId, revision, entries: entries.map(({ id, name, content, keywords }) => ({ id, name, content, keywords })) });
export const listUniversalMods = (token: string, conversationId?: string) =>
  upstream<{ items: UniversalModChoice[] }>(`/workshop/universal/list${q({ conversationId })}`, token);
export const getUniversalMod = (id: string, token: string) =>
  upstream<UniversalMod>(`/workshop/universal/draft${q({ id })}`, token);
export const saveUniversalMod = (mod: UniversalMod, token: string) =>
  upstream<UniversalMod>("/workshop/universal/draft", token, mod);
export const deleteUniversalMod = (id: string, revision: string, token: string) =>
  upstream<{ ok: true }>("/workshop/universal/delete", token, { id, revision });
/** 切換上下文檔位：跟畫布的模型選單存同一個設定（這張卡的遊玩設定），存好才算數 */
export const saveContextTier = (roleId: string, context: number, token: string) => upstream<unknown>("/player/role-settings/save", token, { roleId, context });
export const fetchPolicy = (roleId: string, token: string) => upstream<OwnerPolicy>(`/workshop/policy${q({ roleId })}`, token);
/**
 * 存作者開關走本站：伺服器存進 Provider 後同步更新公開列表才回成功，卡片頁馬上看得到分頁出現或消失
 * （不等背景同步）。cardId 可以是卡號；卡還沒有本站列時也可以是角色 id，原作者由 Provider 認定，不會因此登記或公開這張卡。
 */
export const savePolicy = (cardId: string, allowNew: boolean, expectedRevision: number, token: string) =>
  community<OwnerPolicy>(`/cards/${encodeURIComponent(cardId)}/workshop/policy`, token, "POST", { allowNew, expectedRevision });
/**
 * 原卡作者隱藏／取消隱藏玩家擴充：沒有理由、不通知製作者、沒有申訴。
 * 走本站：伺服器先更新公開列表才回成功，重新整理不會跳回去（跟作者開關同一個做法）。
 */
export const ownerAction = (workshopId: string, action: "hide" | "restore", token: string) =>
  community<{ ownerState: OwnerState; generation?: number }>(`/workshops/${encodeURIComponent(workshopId)}/owner-action`, token, "POST", { action });
export const createWorkshop = (roleId: string, token: string) => upstream<{ workshopId: string }>("/workshop/create", token, { roleId });
export const fetchDraft = (workshopId: string, token: string) => upstream<WorkshopDraft>(`/workshop/draft${q({ workshopId })}`, token);
export const fetchPlayerShares = (roleId: string, token: string) =>
  upstream<{ items: PlayerShareItem[] }>(`/workshop/player-share/list${q({ roleId })}`, token);
export const fetchNewPlayerShareCount = (token: string) =>
  upstream<{ count: number }>("/workshop/player-share/pending-count", token);
export const readPlayerShare = (workshopId: string, token: string) =>
  upstream<PlayerShareContent>(`/workshop/player-share/content${q({ workshopId })}`, token);
export const setPlayerShareConsent = (workshopId: string, draftRevision: number, generation: number, enabled: boolean, token: string) =>
  upstream<PlayerShare>("/workshop/player-share/consent", token, { workshopId, draftRevision, generation, enabled });
export const setPlayerShareDisplay = (item: Pick<PlayerShareItem, "workshopId" | "draftRevision" | "generation">, enabled: boolean, token: string) =>
  upstream<PlayerShare>("/workshop/player-share/display", token, { workshopId: item.workshopId, draftRevision: item.draftRevision, generation: item.generation, enabled });
export const markPlayerShareSeen = (item: Pick<PlayerShareItem, "workshopId" | "draftRevision" | "generation">, token: string) =>
  upstream<{ ok: true }>("/workshop/player-share/seen", token, { workshopId: item.workshopId, draftRevision: item.draftRevision, generation: item.generation });
export const saveDraft = (workshopId: string, expectedRevision: number, idempotencyKey: string, fields: DraftWrite, token: string) =>
  upstream<{ revision: number; errors: DraftError[] }>("/workshop/draft/save", token, { workshopId, expectedRevision, idempotencyKey, ...fields });
export const deleteWorkshop = (workshopId: string, token: string) => upstream<unknown>("/workshop/delete", token, { workshopId });

// ---- 純函式 ----------------------------------------------------------------

export { workshopResidentLimit };

/** 私人玩家擴充的常駐字數上限。 */
export const CONSTANT_CHAR_LIMIT = MAX_PLAYER_CONSTANT_CHARS;

/** 常駐字數：啟用中且勾了常駐的條目內文，以 Unicode 字元計（跟伺服器的 rune 同口徑，不用 UTF-16 長度）。 */
export function constantChars(entries: readonly Pick<WorldbookEntryDraft, "content" | "isEnabled" | "isConstant">[]): number {
  let n = 0;
  for (const e of entries) if (e.isEnabled && e.isConstant) n += Array.from(e.content ?? "").length;
  return n;
}

/** 管理視窗與身分列要畫的三種情況：夠用、低於建議但放得下、放不下 */
export type UsageState = "ok" | "soft" | "over";
export function usageState(s: Pick<UsageSummary, "requestFits" | "currentTierSufficient">): UsageState {
  if (!s.requestFits) return "over";
  return s.currentTierSufficient ? "ok" : "soft";
}

/**
 * 開始對話前要不要先問「上下文放不下」：放不下、而且知道目前是哪一檔才問。
 * 不知道目前檔位時說不出一句完整的話（「目前的 容納不下」），伺服器照樣開始時本來就會降級，不擋。
 */
export function needsCapacityChoice(s: Pick<UsageSummary, "requestFits" | "currentTierSufficient" | "currentContextTokens">): boolean {
  return usageState(s) === "over" && !!s.currentContextTokens;
}

/** 32000 → 「32K」：檔位一律寫成 K，不寫點數 */
export function tierLabel(tokens: number | null | undefined): string {
  return tokens && tokens > 0 ? `${Math.round(tokens / 1000)}K` : "";
}

/** 上移／下移一格；越界就原樣回傳 */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items.slice();
  const next = items.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * 放不下而選「照樣開始」時，常駐會降為觸發載入的是哪一件：清單最上面（最低優先）的啟用中擴充。
 * 伺服器實際降幾件以它為準；管理視窗只預告最上面那一件。
 */
export function firstDemoted(items: readonly SelectionItem[]): string | null {
  return items.find((i) => i.enabled && i.availability !== "removed" && i.availability !== "closed" && i.residentChars > 0)?.workshopId ?? null;
}

/** 編輯頁「發布」分區的三種狀態：草稿｜已發布｜已發布但有未發布的修改 */
export type PublishState = "draft" | "live" | "livechg";
export function publishState(status: MineStatus): PublishState {
  return status === "live" ? "live" : status === "live_changed" ? "livechg" : "draft";
}

/** 發布前的檢查清單；玩家擴充的內容只算世界書，背景圖與更新說明都選填 */
export interface ChecklistItem { key: "basics" | "rating" | "content" | "constant"; ok: boolean }
export function publishChecklist(d: Pick<WorkshopDraft, "kind" | "name" | "summary" | "rating" | "worldbook" | "rules" | "opening">): ChecklistItem[] {
  const hasLore = d.worldbook.some((e) => e.isEnabled !== false && (e.content ?? "").trim());
  const dlc = d.kind === "dlc";
  const hasRule = dlc && (d.rules?.rules?.length > 0 || !!d.rules?.statusbar?.trim());
  const op = d.opening;
  const hasOpening = dlc && !!op && (op.mode === "page" ? !!op.openingPage?.trim() : !!op.welcome?.trim() || (op.alternates ?? []).some((a) => a.trim()));
  return [
    { key: "basics", ok: !!d.name.trim() && !!d.summary.trim() },
    { key: "rating", ok: !!d.rating },
    { key: "content", ok: hasLore || hasRule || hasOpening },
    { key: "constant", ok: constantChars(d.worldbook) <= workshopResidentLimit(d.kind) },
  ];
}
/** 更新說明選填，只限長度（跟卡片的更新說明同一個上限，伺服器另驗） */
export const UPDATE_NOTE_MAX = 200;

/** 擴充沒有封面時的底色（同一個名字永遠同一個顏色），跟卡片的佔位同一套色相 */
export { hueFrom as coverHue } from "./format";
