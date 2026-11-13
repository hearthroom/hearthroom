/**
 * 卡片工坊（擴充）的資料層：型別、請求與幾個畫面要用的純函式。
 *
 * 端點形狀照 docs studio/tasks/2026-11-13-card-workshop/interface-web.md（2026-11-14 與 provider-api、
 * hearthroom-worker、stage 議定）。本站（/v1，Worker）管列表、詳情、版本、評論、我的擴充、送審與通知；
 * Provider（/open/v1/workshop）管加入與排序、字數與建議檔位、草稿、原作者開關與打回／隱藏、申訴。
 *
 * 網頁不自己判斷「分頁要不要出現」「這位玩家能不能加入」「建議用哪一檔」：這些都照伺服器回的欄位畫
 * （tabVisible、availability、usage-summary）。網頁唯一自己算的是編輯頁的常駐字數條，送審仍以伺服器為準。
 */
import { COMMUNITY_API, UPSTREAM_API } from "./config";
import { authHeaders, json } from "./api";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";
import type { WorldbookEntryDraft } from "./role-draft";
import type { RegexRuleSet } from "./regex-rules";

export type WorkshopKind = "lore" | "display" | "opening";
export const WORKSHOP_KINDS: WorkshopKind[] = ["lore", "display", "opening"];

export interface ExtensionAuthor { handle: string | null; name: string; avatar?: string }
export interface ExtensionSummary {
  id: string; cardId: string; name: string; summary: string;
  /** 橫式 16:9；草稿可能沒有，畫面用名稱算出的底色代替 */
  coverUrl: string;
  author: ExtensionAuthor;
  joinCount: number;
  /** 已核准的公開版號 vN；從未上架是 0 */
  version: number;
  updatedAt: number;
  kinds: WorkshopKind[];
  rating: string | null;
  /** 分級高於原卡：加入前要先確認年齡 */
  adult: boolean;
  joined?: boolean;
  /** 原作者看自己的卡時才有 */
  ownerState?: OwnerState;
  ownerReason?: string | null;
  appeal?: AppealState;
}
export type OwnerState = "visible" | "returned" | "hidden";
export type AppealState = null | "pending" | "upheld" | "restored";
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

export type MineStatus = "draft" | "pending" | "rejected" | "live" | "live_changed" | "live_pending" | "live_rejected";
export interface MineItem extends ExtensionSummary {
  card: { id: string; num: number; name: string; roleId: string };
  status: MineStatus;
  rejectNote: string | null;
  ownerState: OwnerState;
  ownerReason: string | null;
  appeal: AppealState;
}
export interface WorkshopCardChoice {
  cardId: string; num: number; name: string; avatarUrl?: string;
  author: { name: string }; roleId: string; allowNew: boolean;
}

export interface SelectionItem {
  workshopId: string; enabled: boolean; name: string; coverUrl: string;
  kinds: WorkshopKind[]; residentChars: number; availability: Availability;
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

export interface OwnerPolicy {
  allowNew: boolean; revision: number;
  items: ExtensionSummary[];
}

export interface WorkshopOpening { mode: "greeting" | "page"; welcome: string; alternates: string[]; prologue: string[]; openingPage: string }
export interface WorkshopDraft {
  workshopId: string; revision: number;
  card: { roleId: string; cardId: string; num: number; name: string; ownerIsMe: boolean };
  name: string; summary: string; readme: string; coverUrl: string;
  rating: string | null; ratingAnswers: Record<string, unknown> | null;
  worldbook: WorldbookEntryDraft[];
  rules: RegexRuleSet;
  opening: WorkshopOpening;
  updateNote: string;
  published: { version: number } | null;
  changedSincePublish: boolean;
}
export type DraftWrite = Pick<WorkshopDraft, "name" | "summary" | "readme" | "coverUrl" | "rating" | "ratingAnswers" | "worldbook" | "rules" | "opening" | "updateNote">;
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
  return json<T>(await fetch(UPSTREAM_API + "/open/v1" + path, {
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
export const submitWorkshop = (id: string, updateNote: string, token: string) =>
  community<{ status: MineStatus }>(`/me/workshops/${encodeURIComponent(id)}/submit`, token, "POST", { updateNote });
export const withdrawWorkshop = (id: string, token: string) =>
  community<{ status: MineStatus }>(`/me/workshops/${encodeURIComponent(id)}/withdraw`, token, "POST", {});
export const fetchWorkshopCards = (query: string, token: string) =>
  community<{ items: WorkshopCardChoice[] }>(`/me/workshop-cards${q({ q: query.trim() })}`, token);

// Provider
export const fetchSelection = (roleId: string, token: string) => upstream<Selection>(`/workshop/selection${q({ roleId })}`, token);
export const installWorkshop = (roleId: string, workshopId: string, token: string) => upstream<Selection>("/workshop/install", token, { roleId, workshopId });
export const uninstallWorkshop = (roleId: string, workshopId: string, token: string) => upstream<Selection>("/workshop/uninstall", token, { roleId, workshopId });
export const saveSelection = (roleId: string, selection: Selection, token: string) =>
  upstream<Selection>("/workshop/selection/save", token, { roleId, expectedRevision: selection.revision, items: selection.items.map((i) => ({ workshopId: i.workshopId, enabled: i.enabled })) });
export const fetchUsageSummary = (roleId: string, token: string) => upstream<UsageSummary>(`/workshop/usage-summary${q({ roleId })}`, token);
/** 切換上下文檔位：跟畫布的模型選單存同一個設定（這張卡的遊玩設定），存好才算數 */
export const saveContextTier = (roleId: string, context: number, token: string) => upstream<unknown>("/player/role-settings/save", token, { roleId, context });
export const fetchPolicy = (roleId: string, token: string) => upstream<OwnerPolicy>(`/workshop/policy${q({ roleId })}`, token);
export const savePolicy = (roleId: string, allowNew: boolean, expectedRevision: number, token: string) =>
  upstream<OwnerPolicy>("/workshop/policy/save", token, { roleId, allowNew, expectedRevision });
export const ownerAction = (workshopId: string, action: "return" | "hide" | "restore", reason: string, token: string) =>
  upstream<{ ownerState: OwnerState; ownerReason: string | null }>("/workshop/owner-action", token, { workshopId, action, reason });
export const appealWorkshop = (workshopId: string, reason: string, token: string) =>
  upstream<{ appeal: AppealState }>("/workshop/appeal", token, { workshopId, reason });
export const createWorkshop = (roleId: string, token: string) => upstream<{ workshopId: string }>("/workshop/create", token, { roleId });
export const fetchDraft = (workshopId: string, token: string) => upstream<WorkshopDraft>(`/workshop/draft${q({ workshopId })}`, token);
export const saveDraft = (workshopId: string, expectedRevision: number, idempotencyKey: string, fields: DraftWrite, token: string) =>
  upstream<{ revision: number; errors: DraftError[] }>("/workshop/draft/save", token, { workshopId, expectedRevision, idempotencyKey, ...fields });
export const deleteWorkshop = (workshopId: string, token: string) => upstream<unknown>("/workshop/delete", token, { workshopId });

// ---- 純函式 ----------------------------------------------------------------

/** 每個擴充的常駐上限（owner 2026-11-14：合計 1,500 字、不限條數；原卡不受限） */
export const CONSTANT_CHAR_LIMIT = 1500;

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
  return items.find((i) => i.enabled && i.availability !== "removed" && i.residentChars > 0)?.workshopId ?? null;
}

/** 編輯頁「發布」分區要畫哪一種狀態（ui.md §4.6 的九種，加上申訴中） */
export type PublishState = "draft" | "review" | "rejected" | "live" | "livechg" | "liveup" | "liverej" | "returned" | "hidden";
export function publishState(status: MineStatus, ownerState: OwnerState): PublishState {
  if (ownerState === "hidden") return "hidden";
  if (ownerState === "returned" && status !== "pending" && status !== "live_pending") return "returned";
  switch (status) {
    case "draft": return "draft";
    case "pending": return "review";
    case "rejected": return "rejected";
    case "live": return "live";
    case "live_changed": return "livechg";
    case "live_pending": return "liveup";
    case "live_rejected": return "liverej";
  }
}

/** 送審前的檢查清單（「已試玩」只是提醒，不擋送審） */
export interface ChecklistItem { key: "basics" | "cover" | "rating" | "content" | "constant" | "note"; ok: boolean }
export function publishChecklist(d: Pick<WorkshopDraft, "name" | "summary" | "coverUrl" | "rating" | "worldbook" | "rules" | "opening" | "published" | "updateNote">): ChecklistItem[] {
  const hasLore = d.worldbook.some((e) => e.isEnabled !== false && (e.content ?? "").trim());
  const hasRule = d.rules.rules.length > 0 || !!d.rules.statusbar.trim();
  const hasOpening = d.opening.mode === "page" ? !!d.opening.openingPage.trim() : !!d.opening.welcome.trim() || d.opening.alternates.some((a) => a.trim());
  const items: ChecklistItem[] = [
    { key: "basics", ok: !!d.name.trim() && !!d.summary.trim() },
    { key: "cover", ok: !!d.coverUrl },
    { key: "rating", ok: !!d.rating },
    { key: "content", ok: hasLore || hasRule || hasOpening },
    { key: "constant", ok: constantChars(d.worldbook) <= CONSTANT_CHAR_LIMIT },
  ];
  if (d.published) items.push({ key: "note", ok: updateNoteValid(d.updateNote) });
  return items;
}
/** 更新說明：10–200 個非空白字（跟卡片的更新說明同一套長度，伺服器另驗） */
export function updateNoteValid(note: string): boolean {
  const text = note.replace(/\r\n?/g, "\n").trim();
  const visible = Array.from(text.replace(/\s/g, "")).length;
  return visible >= 10 && Array.from(text).length <= 200;
}

/** 擴充沒有封面時的底色（同一個名字永遠同一個顏色），跟卡片的佔位同一套色相 */
export { hueFrom as coverHue } from "./format";
