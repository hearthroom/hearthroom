/**
 * 卡片工坊的站方處理與「重新開放時通知我」（ui.md §3.9 ②③；端點見 interface-worker.md §2 第 1、3 點）。
 *
 * - 站方：擴充申訴清單、維持／恢復、依擴充 id 撤下；只有人類 manager／owner 打得通，網頁的分頁與按鈕只是入口，
 *   權限、禁審本人相關案件都由伺服器再判一次。
 * - 玩家：作者暫停新的擴充時登記「重新開放時通知我」。
 *
 * 不改 lib/workshop.ts：它的型別是第一輪議定的契約，這裡用延伸型別補上新欄位。
 */
import { reactive } from "vue";
import { COMMUNITY_API } from "./config";
import { authHeaders, json } from "./api";
import { confirmForm } from "./confirm";
import { i18n } from "./i18n";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";
import type { CardWorkshopPage, OwnerState, WorkshopCardChoice } from "./workshop";

const headers = (token: string, body: boolean): Record<string, string> => ({
  "X-From": currentSurface(), "X-Provider": currentProvider(), ...authHeaders(token),
  ...(body ? { "Content-Type": "application/json" } : {}),
});
async function request<T>(path: string, token: string, method = "GET", body?: unknown): Promise<T> {
  return json<T>(await fetch(COMMUNITY_API + path, {
    method, cache: "no-store", headers: headers(token, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

// ---- 站方：擴充申訴 ----------------------------------------------------------

/**
 * 申訴清單的一筆（端點文件沒寫 items 形狀，這是網頁提議的形狀，主研發寫進契約）。
 * 時間一律毫秒。
 */
export interface WorkshopAppeal {
  /** 申訴案件 id：維持／恢復打 /moderation/workshop-appeals/:id/decision */
  id: string;
  /** 擴充本身：撤下打 /moderation/workshops/:workshop.id/revoke（和案件 id 是兩回事） */
  workshop: { id: string; name: string; coverUrl: string };
  /** 原卡：num 是公開卡號，連結用 */
  card: { id: string; num: number; name: string };
  /** 製作者與原作者：只給顯示名稱與公開 handle，不給內部帳號 id */
  maker: { handle: string | null; name: string };
  owner: { handle: string | null; name: string };
  /** 原作者做了什麼（退回或隱藏）、理由原文、時間 */
  ownerAction: Exclude<OwnerState, "visible">;
  ownerReason: string;
  ownerActedAt: number;
  /** 製作者的申訴理由原文與時間 */
  appealReason: string;
  appealedAt: number;
  status: "pending" | "decided";
  /** 已處理時的結果；站方從申訴面板撤下時案件也算處理完，結果是 revoked */
  result: null | "upheld" | "restored" | "revoked";
  decidedAt: number | null;
  /**
   * 目前這位管理員跟案件的關係：伺服器判（禁審本人相關案件），網頁只照畫。
   * maker＝他是製作者、owner＝他是原卡作者；有值就不出動作鈕。
   */
  viewerRelation: null | "maker" | "owner";
}
export type AppealDecision = "upheld" | "restored";

export const fetchWorkshopAppeals = (status: "pending" | "decided", offset: number, token: string) =>
  request<{ items: WorkshopAppeal[]; hasNext: boolean }>(`/moderation/workshop-appeals?status=${status}&offset=${offset}`, token);
export const decideWorkshopAppeal = (id: string, body: { decision: AppealDecision; reason: string; operationId: string }, token: string) =>
  request<unknown>(`/moderation/workshop-appeals/${encodeURIComponent(id)}/decision`, token, "POST", body);
export const revokeWorkshop = (workshopId: string, body: { reason: string; operationId: string }, token: string) =>
  request<unknown>(`/moderation/workshops/${encodeURIComponent(workshopId)}/revoke`, token, "POST", body);

/**
 * 工作台分頁上的待處理數。審核人的摘要（/review/me）沒有這個數，另讀 /moderation/summary；
 * 版面讀、申訴頁處理完再讀一次，兩邊看同一份。
 */
export const appealCount = reactive({ pending: 0 });
export async function refreshAppealCount(token: string): Promise<void> {
  try {
    const got = await request<{ workshopAppeals?: number }>("/moderation/summary", token);
    appealCount.pending = got.workshopAppeals ?? 0;
  } catch { /* 讀不到就不顯示徽章，不影響分頁 */ }
}

/** 站方撤下的確認框：申訴頁與擴充詳情共用同一個。取消回 null，確認回必填理由。 */
export async function askRevokeReason(name: string): Promise<string | null> {
  const t = i18n.global.t;
  const got = await confirmForm({
    title: t("workshop.moderation.revoke.title", { name }),
    message: t("workshop.moderation.revoke.body"),
    confirmText: t("workshop.moderation.revoke.confirm"),
    cancelText: t("dialog.cancel"),
    danger: true,
    field: { label: t("workshop.moderation.revoke.reason"), required: true, multiline: true, maxlength: 2000 },
  });
  return got?.text.trim() || null;
}

// ---- 玩家：重新開放時通知我 ---------------------------------------------------

/** 卡片工坊頁在已登入且 allowNew=false 時多帶 viewerInterested */
export type CardWorkshopPageWithInterest = CardWorkshopPage & { viewerInterested?: boolean };
/** 選卡彈層的卡：端點目前沒帶 viewerInterested，帶了就照它畫 */
export type WorkshopCardChoiceWithInterest = WorkshopCardChoice & { viewerInterested?: boolean };

export const registerWorkshopInterest = (cardId: string, draftName: string, token: string) =>
  request<{ interested: boolean }>(`/cards/${encodeURIComponent(cardId)}/workshop/interest`, token, "PUT", draftName ? { draftName } : {});
export const cancelWorkshopInterest = (cardId: string, token: string) =>
  request<{ interested: boolean }>(`/cards/${encodeURIComponent(cardId)}/workshop/interest`, token, "DELETE");

/**
 * 這次瀏覽裡登記過的結果（帳號＋卡）。卡片頁的工坊分頁切走再切回來會用同一份舊的 initial 重新掛上，
 * 選卡彈層登記的也要讓卡片頁知道；以這裡為準，沒有才看伺服器帶的 viewerInterested。
 */
const interestSeen = reactive(new Map<string, boolean>());
const interestKey = (account: number | string, cardId: string) => `${account}:${cardId}`;
export function knownInterest(account: number | string, cardId: string): boolean | undefined {
  return interestSeen.get(interestKey(account, cardId));
}
export function rememberInterest(account: number | string, cardId: string, on: boolean): void {
  interestSeen.set(interestKey(account, cardId), on);
}
export function forgetInterests(): void { interestSeen.clear(); }
