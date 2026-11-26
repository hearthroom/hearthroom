/**
 * 推廣貼文逐篇歸因（任務 2026-11-25-post-attribution）：每篇貼文的代號是它連結上的 utm_campaign。
 * 沒登入的人點進來先記下代號，之後在這個瀏覽器註冊、登入，就送一次給本站伺服器，
 * 由伺服器確認代號有登記、帳號是點了之後才建立的，才記成那篇貼文帶來的新玩家。
 * 規則比照活動分享碼：代號算最後點的那個，時間留第一次點的，放 30 天。
 * 只存代號與時間，不存網址或任何身分；推薦碼（?ref）與活動分享碼（?s）照舊各走各的。
 */
import { watch } from "vue";
import { COMMUNITY_API } from "./config";
import { currentProvider } from "./provider";
import { useSession } from "./session";
import { signedInHint } from "./signin-hint";

const KEY = "hearthroom.promoPost";
const TTL = 30 * 86_400_000;
const CAMPAIGN = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface Stored { campaign: string; at: number }

/** 網址上唯一一個、格式合法的 utm_campaign；有沒有登記由伺服器判斷。 */
export function promoPostFromUrl(href: string): string | null {
  try {
    const values = new URL(href).searchParams.getAll("utm_campaign");
    return values.length === 1 && CAMPAIGN.test(values[0]!) ? values[0]! : null;
  } catch { return null; }
}

export function pendingPromoPost(now = Date.now()): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    if (typeof value.campaign === "string" && typeof value.at === "number" && now - value.at < TTL) return { campaign: value.campaign, at: value.at };
    localStorage.removeItem(KEY);
  } catch { /* 壞掉的紀錄當沒有 */ }
  return null;
}

/** 代號算最後點的那個，時間留第一次點的：後來的點擊不能把「第一次來站」往後推過註冊時間。 */
export function rememberPromoPost(campaign: string, now = Date.now()): void {
  const at = Math.min(pendingPromoPost(now)?.at ?? now, now);
  try { localStorage.setItem(KEY, JSON.stringify({ campaign, at } satisfies Stored)); } catch { /* 存不了就不算 */ }
}

function forgetPromoPost(): void {
  try { localStorage.removeItem(KEY); } catch { /* 無妨 */ }
}

/** 進站時呼叫（router）：沒登入、網址帶合法代號才記。登入中的人不是新玩家。 */
export function notePromoPost(href: string, now = Date.now()): void {
  if (signedInHint() !== null) return;
  const campaign = promoPostFromUrl(href);
  if (campaign) rememberPromoPost(campaign, now);
}

export type PromoPostOutcome = "none" | "no_token" | "bound" | "done" | "retry";
let running: Promise<PromoPostOutcome> | null = null;

/**
 * 登入後送一次綁定。伺服器有結論（200，不論綁上與否；或其他 4xx）就清掉紀錄；網路錯誤、5xx，
 * 以及令牌過期或暫時被擋（401／403／429）都留著下次再試，免得默默少算一位新玩家。
 */
export function bindPromoPost(token: () => Promise<string | null>): Promise<PromoPostOutcome> {
  if (!running) running = attempt(token).finally(() => { running = null; });
  return running;
}

async function attempt(token: () => Promise<string | null>): Promise<PromoPostOutcome> {
  const post = pendingPromoPost();
  if (!post) return "none";
  try {
    const t = await token();
    if (!t) return "no_token";
    const res = await fetch(`${COMMUNITY_API}/me/promo-attribution`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "X-Provider": currentProvider(), "Content-Type": "application/json" },
      body: JSON.stringify({ campaign: post.campaign, firstSeenAt: post.at }),
    });
    if (res.status >= 500 || res.status === 401 || res.status === 403 || res.status === 429) return "retry";
    forgetPromoPost();
    const body = res.ok ? ((await res.json().catch(() => null)) as { bound?: boolean } | null) : null;
    return body?.bound ? "bound" : "done";
  } catch {
    return "retry";
  }
}

/** 掛在 App 上：每次有人登入（含開站恢復登入）就試著綁一次。沒有記下的代號就什麼都不做。 */
export function watchPromoPostBinding(): void {
  const session = useSession();
  watch(() => session.me?.accountNumId ?? null, (id) => {
    if (id && pendingPromoPost()) void bindPromoPost(() => session.accessToken());
  }, { immediate: true });
}
