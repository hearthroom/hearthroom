/**
 * 分享連結帶推薦碼：登入的人分享卡片時網址帶 ?ref=<自己的碼>；訪客點進來先記下，
 * 之後在這個瀏覽器新註冊，就自動替他填上，推薦人拿得到他之後儲值的獎勵。
 *
 * 規則照一般推薦活動的做法（owner 2026-10-13 定）：
 * - 點連結只是記下，註冊那一刻才決定算誰的；記錄放 30 天，期間點了好幾個人的，算最後一個。
 * - 只算「點了之後才註冊」的帳號：老帳號點了別人的連結不算被邀請（比對服務回的註冊時間）。
 * - 這種綁定是暫定的：朋友另外私下給了碼，本人在推薦頁手動填一次可以換掉（服務端管期限與付款鎖定）。
 * 存在 localStorage 而不是 sessionStorage：點了連結常常是隔天、換個分頁才回來註冊。
 */
import { watch } from "vue";
import { ApiError, fetchReferral, redeemReferral } from "./api";
import { accountToken } from "./connections";
import { currentProvider, type ProviderId } from "./provider";
import { useSession } from "./session";

const KEY = "hearthroom.shareRef";
export const SHARE_REF_TTL = 30 * 24 * 60 * 60 * 1000;
/**
 * 「點連結之後才註冊」的比對容許誤差：點擊時間是瀏覽器的鐘，註冊時間是服務的鐘，
 * 兩邊差幾分鐘時，剛點完就註冊的人不該被當成老帳號。早幾分鐘註冊又點了陌生人的連結，
 * 誤綁的代價也只是他得在推薦頁換一次。
 */
const CLOCK_SLACK = 10 * 60 * 1000;
const CODE = /^[A-Z0-9]{4,32}$/;

interface Stored { code: string; at: number }

/** 網址上的 ?ref=。不像推薦碼的值不理，但一樣從網址拿掉。 */
export function refFromQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/** 記下這次點進來的碼；之前記的（另一個人的）被蓋掉：算最後一個。 */
export function rememberShareRef(code: string, now = Date.now()): void {
  try { localStorage.setItem(KEY, JSON.stringify({ code, at: now } satisfies Stored)); } catch { /* 存不了就不帶 */ }
}

export function pendingShareRef(now = Date.now()): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    if (typeof value.code === "string" && typeof value.at === "number" && now - value.at < SHARE_REF_TTL) return { code: value.code, at: value.at };
    localStorage.removeItem(KEY);
  } catch { /* 壞掉的紀錄當沒有 */ }
  return null;
}

export function forgetShareRef(): void {
  try { localStorage.removeItem(KEY); } catch { /* 無妨 */ }
}

export type ShareRefOutcome = "none" | "no_token" | "bound" | "existing_account" | "not_eligible" | "rejected" | "retry";

let running: Promise<ShareRefOutcome> | null = null;

/**
 * 登入之後呼叫：有記下的碼、帳號是點了之後才註冊的、服務說還能填，就以連結來源填上。
 * 有結論（填了、不符合、被拒）就把紀錄清掉；網路暫時不通則留著，下次開站再試。
 */
export function bindShareRef(token: () => Promise<string | null>, provider: ProviderId): Promise<ShareRefOutcome> {
  if (!running) running = attempt(token, provider).finally(() => { running = null; });
  return running;
}

async function attempt(token: () => Promise<string | null>, provider: ProviderId): Promise<ShareRefOutcome> {
  const ref = pendingShareRef();
  if (!ref) return "none";
  try {
    const t = await token();
    if (!t) return "no_token";
    const summary = await fetchReferral(t, provider);
    if (!summary.enabled || summary.referred || !summary.canRedeem) {
      forgetShareRef();
      return "not_eligible";
    }
    // 服務沒回註冊時間（還沒升級）就分不出新舊帳號：寧可不帶，留著紀錄等服務升級後再試。
    const registered = Date.parse(summary.registeredAt);
    if (Number.isNaN(registered)) return "retry";
    if (registered < ref.at - CLOCK_SLACK) {
      forgetShareRef();
      return "existing_account";
    }
    await redeemReferral(t, ref.code, provider, "link");
    forgetShareRef();
    return "bound";
  } catch (err) {
    // 只有服務說「這個碼不行」（找不到、推薦自己、已綁定、過了期限）才不再試。
    // 限流（429）、憑證剛好失效（401）、還沒授權推薦（403）都不是碼的問題：留著，下次開站再試，不然就漏了這筆返點。
    if (definitelyRejected(err)) {
      forgetShareRef();
      return "rejected";
    }
    return "retry";
  }
}

/** 400／409：碼或帳號資格被拒，再送一次結果也一樣。 */
function definitelyRejected(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 400 || err.status === 409);
}

/** 推薦服務認的帳號編號：那一家的連結身分，沒有就用本站登入的編號（跟推薦頁同一套）。 */
async function serviceAccount(id: number, provider: ProviderId): Promise<number> {
  const session = useSession();
  await session.ensureProfile();
  return session.profile?.identities.find((i) => i.provider === provider)?.externalId ?? id;
}

/** 掛在 App 上：每次有人登入（含開站恢復登入）就試著帶入記下的碼。沒有記下的碼就什麼都不做。 */
export function watchShareRefBinding(): void {
  const session = useSession();
  watch(() => session.me?.accountNumId ?? null, async (id) => {
    if (!id || !pendingShareRef()) return;
    const provider = currentProvider();
    const account = await serviceAccount(id, provider);
    void bindShareRef(() => accountToken(provider, account), provider);
  }, { immediate: true });
}

/** 目前登入者的推薦碼（分享網址用）；沒登入或讀不到回 null。 */
export async function currentReferralCode(id: number): Promise<string | null> {
  const provider = currentProvider();
  const account = await serviceAccount(id, provider);
  return ownReferralCode(String(account), () => accountToken(provider, account), provider);
}

const ownCodes = new Map<string, Promise<string | null>>();

/**
 * 自己的推薦碼，給分享網址用。一個帳號的碼不會變，每個帳號只問一次；
 * 讀不到（舊的登入沒授權推薦、服務暫時不通）就回 null，分享照舊不帶碼，絕不為此要人重新登入。
 * 沒授權推薦（403）的 null 也記住，免得每開一張卡就再被拒一次；限流、暫時不通的下次再問。
 */
export function ownReferralCode(account: string, token: () => Promise<string | null>, provider: ProviderId): Promise<string | null> {
  const key = `${provider}:${account}`;
  let hit = ownCodes.get(key);
  if (!hit) {
    hit = (async () => {
      try {
        const t = await token();
        if (!t) { ownCodes.delete(key); return null; }
        const summary = await fetchReferral(t, provider);
        return summary.enabled ? summary.code : null;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 403)) ownCodes.delete(key);
        return null;
      }
    })();
    ownCodes.set(key, hit);
  }
  return hit;
}

/** 分享網址加上 ?ref=。 */
export function withShareRef(url: string, code: string | null): string {
  if (!code) return url;
  const u = new URL(url);
  u.searchParams.set("ref", code);
  return u.href;
}

/** 活動分享連結：有推薦碼先帶 ?ref=，再帶分享短碼 ?s=（記錄歸因在之後的計畫）。 */
export function withCampaignShare(url: string, refCode: string | null, shareCode: string): string {
  const u = new URL(withShareRef(url, refCode));
  u.searchParams.set("s", shareCode);
  return u.href;
}
