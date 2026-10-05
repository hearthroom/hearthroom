import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { HttpError, pickLocale, type Env, type Localized } from "../types";
import { updateTitle } from "../updates";
import { noticeNote } from "../../shared/notice-note";

/**
 * 瀏覽器推播。
 *
 * 通知的正本是 community_notifications（由 trigger 寫入）；這裡只負責「有新的就推給訂閱了的
 * 瀏覽器」。派送是拉的：每次會產生通知的請求結尾、以及每小時的排程，都呼叫 dispatchPush 把
 * push_at 還是空的通知推出去。這樣 trigger 不必知道推播存在，推播掛了也只是晚一點收到。
 *
 * 推播內容在這裡組（五語），跟網站上鈴鐺的句子是同一套意思；網站那份在 web/src/locales，
 * 兩邊都改才算改完。Discord 私訊也用 pushLine 這句（經 bridge 的 notification 交給 bot）。
 * 送出去的只有一句話和落點路徑：名字與卡名已經是站內公開資訊。
 */
export const PUSH_LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
export type PushLocale = (typeof PUSH_LOCALES)[number];
export const pushLocale = (value: unknown): PushLocale => (PUSH_LOCALES.includes(value as PushLocale) ? (value as PushLocale) : "zh-Hant");

export function pushConfigured(env: Env): boolean {
  return !!(env.PUSH_VAPID_PUBLIC_KEY && env.PUSH_VAPID_PRIVATE_KEY && env.PUSH_VAPID_SUBJECT);
}

type Row = { id: string; member_id: string; kind: string; path: string; extra: string | null; actor_name: string | null; actor_handle: string | null; card_names: string | null };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; locale: string | null; failures: number };

const quote = (locale: PushLocale, name: string) => (locale.startsWith("zh") ? `「${name}」` : locale === "ja" ? `『${name}』` : `“${name}”`);
type Copy = {
  title: string; reply: string; replyPlain: string; work: string; workNew: string; workUpdate: string; workPlain: string;
  approved: string; approvedUpdate: string; rejected: string; rejectedNote: string; rejectedUpdate: string; rejectedUpdateNote: string; reviewPlain: string;
  like: string; likes: string; pack: string; packCount: string; reminder: string; reminderCard: string; shipped: string; generic: string;
};
const copy: Record<PushLocale, Copy> = {
  "zh-Hant": {
    title: "HearthRoom", reply: "{actor} 回覆了你在{card}的留言", replyPlain: "有人回覆你的留言",
    work: "{actor} 發佈或更新了{card}", workNew: "{actor} 發佈了{card}", workUpdate: "{actor} 更新了{card}", workPlain: "追蹤的作者有新作品或更新",
    approved: "{card}審核通過了", approvedUpdate: "{card}的更新審核通過了",
    rejected: "{card}這次沒有通過審核", rejectedNote: "{card}這次沒有通過審核，審核員說：{note}",
    rejectedUpdate: "{card}的更新這次沒有通過審核", rejectedUpdateNote: "{card}的更新這次沒有通過審核，審核員說：{note}", reviewPlain: "審核結果已更新",
    like: "{actor} 讚了你在{card}的留言", likes: "{actor} 和另外 {others} 人讚了你在{card}的留言",
    pack: "你收到了額外的登記次數", packCount: "你可以在每週額度之外再登記 {count} 次",
    reminder: "你認領的作品即將到期，請繼續審核或放回待審清單", reminderCard: "你認領的{card}即將到期，請繼續審核或放回待審清單",
    shipped: "你回報的事已經處理好了：{title}", generic: "有新的通知",
  },
  "zh-Hans": {
    title: "HearthRoom", reply: "{actor} 回复了你在{card}的评论", replyPlain: "有人回复你的评论",
    work: "{actor} 发布或更新了{card}", workNew: "{actor} 发布了{card}", workUpdate: "{actor} 更新了{card}", workPlain: "关注的作者有新作品或更新",
    approved: "{card}审核通过了", approvedUpdate: "{card}的更新审核通过了",
    rejected: "{card}这次没有通过审核", rejectedNote: "{card}这次没有通过审核，审核员说：{note}",
    rejectedUpdate: "{card}的更新这次没有通过审核", rejectedUpdateNote: "{card}的更新这次没有通过审核，审核员说：{note}", reviewPlain: "审核结果已更新",
    like: "{actor} 点赞了你在{card}的评论", likes: "{actor} 和另外 {others} 人点赞了你在{card}的评论",
    pack: "你收到了额外的登记次数", packCount: "你可以在每周额度之外再登记 {count} 次",
    reminder: "你认领的作品即将到期，请继续审核或放回待审列表", reminderCard: "你认领的{card}即将到期，请继续审核或放回待审列表",
    shipped: "你反馈的事已经处理好了：{title}", generic: "有新的通知",
  },
  en: {
    title: "HearthRoom", reply: "{actor} replied to your comment on {card}", replyPlain: "Someone replied to your comment",
    work: "{actor} published or updated {card}", workNew: "{actor} published {card}", workUpdate: "{actor} updated {card}", workPlain: "An author you follow published or updated a work",
    approved: "{card} passed review", approvedUpdate: "Your update to {card} passed review",
    rejected: "{card} did not pass review this time", rejectedNote: "{card} did not pass review this time. The reviewer wrote: {note}",
    rejectedUpdate: "Your update to {card} did not pass review this time", rejectedUpdateNote: "Your update to {card} did not pass review this time. The reviewer wrote: {note}", reviewPlain: "Your review result was updated",
    like: "{actor} liked your comment on {card}", likes: "{actor} and {others} others liked your comment on {card}",
    pack: "You received extra listings", packCount: "You can now list {count} more beyond your weekly quota",
    reminder: "Your review claim expires soon. Continue reviewing or release it to the queue.", reminderCard: "Your claim on {card} expires soon. Continue reviewing or release it to the queue.",
    shipped: "What you reported is now live: {title}", generic: "You have a new notification",
  },
  ja: {
    title: "HearthRoom", reply: "{actor} さんが{card}へのコメントに返信しました", replyPlain: "コメントに返信がありました",
    work: "{actor} さんが{card}を公開・更新しました", workNew: "{actor} さんが{card}を公開しました", workUpdate: "{actor} さんが{card}を更新しました", workPlain: "フォロー中の作者が作品を公開・更新しました",
    approved: "{card}が審査を通過しました", approvedUpdate: "{card}の更新が審査を通過しました",
    rejected: "{card}は今回審査を通過しませんでした", rejectedNote: "{card}は今回審査を通過しませんでした。審査担当者のコメント：{note}",
    rejectedUpdate: "{card}の更新は今回審査を通過しませんでした", rejectedUpdateNote: "{card}の更新は今回審査を通過しませんでした。審査担当者のコメント：{note}", reviewPlain: "審査結果が更新されました",
    like: "{actor} さんが{card}へのコメントにいいねしました", likes: "{actor} さんと他 {others} 人が{card}へのコメントにいいねしました",
    pack: "追加の掲載枠を受け取りました", packCount: "週ごとの枠とは別に、あと {count} 件掲載できるようになりました",
    reminder: "担当の有効期限が近づいています。審査を続けるか、一覧に戻してください。", reminderCard: "担当中の{card}の有効期限が近づいています。審査を続けるか、一覧に戻してください。",
    shipped: "ご報告いただいた件が反映されました：{title}", generic: "新しいお知らせがあります",
  },
  ko: {
    title: "HearthRoom", reply: "{actor} 님이 {card}에 남긴 내 댓글에 답글을 달았습니다", replyPlain: "내 댓글에 답글이 달렸습니다",
    work: "{actor} 님이 {card}을(를) 공개하거나 업데이트했습니다", workNew: "{actor} 님이 {card}을(를) 공개했습니다", workUpdate: "{actor} 님이 {card}을(를) 업데이트했습니다", workPlain: "팔로우하는 작가가 작품을 공개하거나 업데이트했습니다",
    approved: "{card}이(가) 심사를 통과했습니다", approvedUpdate: "{card}의 업데이트가 심사를 통과했습니다",
    rejected: "{card}이(가) 이번 심사를 통과하지 못했습니다", rejectedNote: "{card}이(가) 이번 심사를 통과하지 못했습니다. 검토자 의견: {note}",
    rejectedUpdate: "{card}의 업데이트가 이번 심사를 통과하지 못했습니다", rejectedUpdateNote: "{card}의 업데이트가 이번 심사를 통과하지 못했습니다. 검토자 의견: {note}", reviewPlain: "심사 결과가 업데이트되었습니다",
    like: "{actor} 님이 {card}에 남긴 내 댓글을 좋아합니다", likes: "{actor} 님 외 {others}명이 {card}에 남긴 내 댓글을 좋아합니다",
    pack: "추가 등록 횟수를 받았습니다", packCount: "주간 한도와 별도로 {count}번 더 등록할 수 있습니다",
    reminder: "검토 담당 시간이 곧 만료됩니다. 검토를 계속하거나 대기 목록으로 돌려보내세요.", reminderCard: "담당한 {card}의 검토 시간이 곧 만료됩니다. 검토를 계속하거나 대기 목록으로 돌려보내세요.",
    shipped: "제보하신 내용이 반영되었습니다: {title}", generic: "새 알림이 있습니다",
  },
};
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
/** The sentence a browser notification and a Discord DM show; mirrors noticeText on the website. */
export function pushLine(row: Pick<Row, "kind" | "extra" | "actor_name" | "actor_handle" | "card_names">, locale: PushLocale): string {
  const c = copy[locale];
  const extra = row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : {};
  const actor = row.actor_name || row.actor_handle || "";
  const card = row.card_names ? quote(locale, pickLocale(JSON.parse(row.card_names) as Localized, locale)) : "";
  const count = Number(extra.count ?? 1);
  if (row.kind === "comment_reply") return actor && card ? fill(c.reply, { actor, card }) : c.replyPlain;
  if (row.kind === "followed_work") {
    if (!actor || !card) return c.workPlain;
    return fill(extra.event === "new" ? c.workNew : extra.event === "update" ? c.workUpdate : c.work, { actor, card });
  }
  if (row.kind === "review_result") {
    if (!card) return c.reviewPlain;
    const update = extra.kind === "re";
    if (extra.status !== "rejected") return fill(update ? c.approvedUpdate : c.approved, { card });
    const note = noticeNote(extra.note);
    return fill(note ? (update ? c.rejectedUpdateNote : c.rejectedNote) : update ? c.rejectedUpdate : c.rejected, { card, note });
  }
  if (row.kind === "comment_like" && actor && card) return count > 1 ? fill(c.likes, { actor, card, others: count - 1 }) : fill(c.like, { actor, card });
  if (row.kind === "registration_pack") return Number(extra.granted) > 0 ? fill(c.packCount, { count: Number(extra.granted) }) : c.pack;
  if (row.kind === "review_reminder") return card ? fill(c.reminderCard, { card }) : c.reminder;
  if (row.kind === "report_shipped" && typeof extra.entry === "string") {
    const title = updateTitle(extra.entry, locale);
    if (title) return fill(c.shipped, { title: title.replace(/[。.]$/, "") });
  }
  return c.generic;
}

export async function saveSubscription(env: Env, member: string, input: Record<string, unknown>): Promise<void> {
  const keys = (input.keys ?? {}) as Record<string, unknown>;
  const endpoint = typeof input.endpoint === "string" ? input.endpoint : "";
  if (!/^https:\/\/[^\s]{1,2000}$/.test(endpoint) || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth))
    throw new HttpError(400, "community_input");
  const locale = PUSH_LOCALES.includes(input.locale as PushLocale) ? (input.locale as string) : null;
  // A browser re-subscribing (or another member signing in on the same browser) replaces the old owner of that endpoint.
  await env.DB.prepare(
    "INSERT INTO push_subscriptions(member_id,endpoint,p256dh,auth,locale,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id,p256dh=excluded.p256dh,auth=excluded.auth,locale=COALESCE(excluded.locale,push_subscriptions.locale),failures=0",
  ).bind(member, endpoint, keys.p256dh, keys.auth, locale, Date.now()).run();
}
export async function removeSubscription(env: Env, member: string, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string") throw new HttpError(400, "community_input");
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE member_id=? AND endpoint=?").bind(member, endpoint).run();
}
export async function hasSubscription(env: Env, member: string, endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== "string") return false;
  return !!(await env.DB.prepare("SELECT 1 FROM push_subscriptions WHERE member_id=? AND endpoint=?").bind(member, endpoint).first());
}

export type PushSender = (sub: PushSubscription, data: { title: string; body: string; path: string; tag: string }, env: Env) => Promise<number>;
/** Encrypts and posts one message; returns the push service's status code. */
export const sendWebPush: PushSender = async (sub, data, env) => {
  const payload = await buildPushPayload({ data, options: { ttl: 86400, urgency: "normal", topic: data.tag.slice(0, 32) } }, sub, {
    subject: env.PUSH_VAPID_SUBJECT,
    publicKey: env.PUSH_VAPID_PUBLIC_KEY,
    privateKey: env.PUSH_VAPID_PRIVATE_KEY,
  });
  const res = await fetch(sub.endpoint, payload);
  return res.status;
};

const MAX_FAILURES = 5;
/**
 * Push every notification nobody has pushed yet to its member's subscribed browsers.
 * Gone subscriptions (404/410) are dropped at once; other failures count up and the
 * subscription is dropped after MAX_FAILURES in a row. Returns how many messages went out.
 */
export async function dispatchPush(env: Env, send: PushSender = sendWebPush): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const now = Date.now();
  const rows = (
    await env.DB.prepare(
      `SELECT n.id,n.member_id,n.kind,n.path,n.extra,a.display_name AS actor_name,a.handle AS actor_handle,c.names AS card_names
       FROM community_notifications n LEFT JOIN members a ON a.id=n.actor_id LEFT JOIN cards c ON c.id=n.card_id
       WHERE n.push_at IS NULL AND n.created_at>? AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.member_id=n.member_id)
       ORDER BY n.created_at LIMIT 40`,
    ).bind(now - 86400000).all<Row>()
  ).results;
  // Everything else without a subscriber is settled in one statement so the index stays small.
  await env.DB.prepare("UPDATE community_notifications SET push_at=? WHERE push_at IS NULL AND created_at<=? AND NOT EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.member_id=community_notifications.member_id)").bind(now, now).run();
  let sent = 0;
  for (const row of rows) {
    const subs = (await env.DB.prepare("SELECT id,endpoint,p256dh,auth,locale,failures FROM push_subscriptions WHERE member_id=?").bind(row.member_id).all<Sub>()).results;
    const site = row.path.startsWith("/") ? row.path : "/me/community";
    for (const sub of subs) {
      const locale = pushLocale(sub.locale);
      let status = 0;
      try {
        status = await send({ endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } }, { title: copy[locale].title, body: pushLine(row, locale), path: site, tag: row.id }, env);
      } catch { status = 0; }
      if (status >= 200 && status < 300) {
        sent++;
        await env.DB.prepare("UPDATE push_subscriptions SET last_ok=?,failures=0 WHERE id=?").bind(now, sub.id).run();
      } else if (status === 404 || status === 410 || sub.failures + 1 >= MAX_FAILURES) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(sub.id).run();
      } else {
        await env.DB.prepare("UPDATE push_subscriptions SET failures=failures+1 WHERE id=?").bind(sub.id).run();
      }
    }
    await env.DB.prepare("UPDATE community_notifications SET push_at=? WHERE id=?").bind(now, row.id).run();
  }
  return sent;
}

/** Hook for request handlers that just created notifications: push after the response goes out. */
export function queuePush(c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }): void {
  if (!pushConfigured(c.env)) return;
  c.executionCtx.waitUntil(dispatchPush(c.env).catch(() => { console.warn("push dispatch unavailable"); }));
}
