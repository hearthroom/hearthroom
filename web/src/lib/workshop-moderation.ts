/**
 * 卡片工坊的站方撤下（端點見 interface-worker.md §2 第 3 點）。
 *
 * 只有人類 manager／owner 打得通；擴充詳情頁的按鈕只是入口，權限由伺服器再判一次。
 */
import { COMMUNITY_API } from "./config";
import { authHeaders, json } from "./api";
import { confirmForm } from "./confirm";
import { i18n } from "./i18n";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";

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

export const revokeWorkshop = (workshopId: string, body: { reason: string; operationId: string }, token: string) =>
  request<unknown>(`/moderation/workshops/${encodeURIComponent(workshopId)}/revoke`, token, "POST", body);

/** 站方撤下的確認框。取消回 null，確認回必填理由。 */
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
