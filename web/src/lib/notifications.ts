import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { communityRequest, type CommunityNotice } from "./community";
import { i18n } from "./i18n";
import { useSession } from "./session";
import { noticeNote } from "../../../shared/notice-note";

/**
 * 頁首鈴鐺的狀態：未讀數（每分鐘與回到分頁時輪詢）與打開浮層時才載入的清單。
 *
 * 輪詢順便把目前的介面語言交給伺服器，Discord 私訊才知道該用哪種語言說話。
 * 已讀是樂觀更新：先把畫面改掉再送出，送失敗也只是下一次輪詢把數字修回來。
 */
export const useNotifications = defineStore("notifications", () => {
  const session = useSession();
  const unread = ref(0);
  const items = ref<CommunityNotice[]>([]);
  const loaded = ref(false);
  const busy = ref(false);
  let generation = 0;

  async function token(): Promise<string | null> {
    return session.me ? await session.accessToken() : null;
  }
  function reset() { generation++; unread.value = 0; items.value = []; loaded.value = false; }

  async function refresh(locale: string): Promise<void> {
    const requestGeneration = ++generation;
    try {
      const t = await token();
      if (!t || requestGeneration !== generation) return;
      const result = await communityRequest<{ unread: number }>(`/me/community/notifications/summary?lang=${encodeURIComponent(locale)}`, t);
      if (requestGeneration === generation) unread.value = result.unread;
    } catch { /* 下一輪再試；鈴鐺上的數字只是提示 */ }
  }
  async function load(locale: string): Promise<void> {
    const requestGeneration = generation;
    busy.value = true;
    try {
      const t = await token();
      if (!t || requestGeneration !== generation) return;
      const result = await communityRequest<{ items: CommunityNotice[] }>(`/me/community/notifications?lang=${encodeURIComponent(locale)}`, t);
      if (requestGeneration !== generation) return;
      items.value = result.items;
      unread.value = result.items.filter(n => !n.read_at).length;
      loaded.value = true;
    } catch { /* 清單載不到時浮層顯示空態與重試 */ } finally { busy.value = false; }
  }
  async function read(notice: CommunityNotice): Promise<void> {
    if (notice.read_at) return;
    notice.read_at = Date.now();
    unread.value = Math.max(0, unread.value - 1);
    try { const t = await token(); if (t) await communityRequest("/me/community/notifications/read", t, "POST", { id: notice.id }); } catch { /* 下一次輪詢修正 */ }
  }
  async function readAll(): Promise<void> {
    const now = Date.now();
    for (const n of items.value) if (!n.read_at) n.read_at = now;
    unread.value = 0;
    try { const t = await token(); if (t) await communityRequest("/me/community/notifications/read-all", t, "POST"); } catch { /* 同上 */ }
  }

  watch(() => session.me?.accountNumId ?? null, () => reset());
  return { unread, items, loaded, busy, refresh, load, read, readAll };
});

/** Quote a card name the way each language does; vue-i18n keeps the brackets out of the translations. */
function quote(locale: string, name: string): string {
  if (locale.startsWith("zh")) return `「${name}」`;
  if (locale === "ja") return `『${name}』`;
  return `“${name}”`;
}

/** One line that says who did what to which card; falls back to the plain kind label when the record carries no detail. */
export function noticeText(n: CommunityNotice): string {
  const t = i18n.global.t;
  const locale = String(i18n.global.locale.value);
  const card = n.card?.name ? quote(locale, n.card.name) : "";
  const actor = n.actor?.name ?? "";
  const extra = n.extra ?? {};
  const count = Number(extra.count ?? 1);
  if (n.kind === "comment_reply" && actor && card) return t("community.noticeText.comment_reply", { actor, card });
  if (n.kind === "followed_work" && actor && card)
    return t(extra.event === "new" ? "community.noticeText.followed_work_new" : extra.event === "update" ? "community.noticeText.followed_work_update" : "community.noticeText.followed_work", { actor, card });
  if (n.kind === "review_result" && card) {
    const update = extra.kind === "re";
    if (extra.status !== "rejected") return t(update ? "community.noticeText.review_update_approved" : "community.noticeText.review_approved", { card });
    const note = noticeNote(extra.note);
    const key = (update ? "community.noticeText.review_update_rejected" : "community.noticeText.review_rejected") + (note ? "_note" : "");
    return t(key, { card, note });
  }
  if (n.kind === "report_shipped" && typeof extra.title === "string") return t("community.noticeText.report_shipped", { title: extra.title.replace(/[。.]$/, "") });
  if (n.kind === "comment_like" && actor && card)
    return count > 1 ? t("community.noticeText.comment_like_many", { actor, card, others: count - 1 }) : t("community.noticeText.comment_like", { actor, card });
  if (n.kind === "registration_pack" && Number(extra.granted) > 0) return t("community.noticeText.registration_pack", { count: Number(extra.granted) });
  if (n.kind === "review_reminder" && card) return t("community.noticeText.review_reminder", { card });
  return t("community.notices." + n.kind);
}
