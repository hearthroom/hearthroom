/**
 * 直接開另一個網域時的靜默登入：像 Google 那樣，Harbor 那邊已經登入、而且早就是本站會員的人，
 * 不用再按一次登入（backend.md「靜默授權介面」）。
 *
 * 只在這裡把關的規則（Worker 不知道使用者連 Harbor 快不快、剛才是不是自己登出的）：
 *   - Harbor 要夠快：先用 ≤1.5 秒探一次，慢或不通就略過，直接顯示登入鈕——中國的使用者連 Harbor
 *     常常很慢，不能讓他卡在一次看不見的跳轉上（owner 2026-10-22）。略過不算一次嘗試。
 *   - 每個網域最多 7 天一次（PM 2026-10-22，ui.md §10 問題 3）：沒有帳號的訪客每次造訪都多跳一趟不值得。
 *     跳走之前就先記下，回呼出了任何事都不會循環。
 *   - 剛登出的網域 7 天內不做，否則登出之後立刻又被登回去。
 *   - 遊玩與聊天頁不做（沉浸中不打擾）。
 *   - 頂層跳轉，不用 iframe（第三方 cookie 與點擊劫持）。
 *
 * **SILENT_LOGIN_ENABLED 預設關閉。** Harbor 還不支援 prompt=none 時，帶著它跳過去會落在 Harbor 的
 * 互動登入頁——每個匿名訪客每週被帶走一次。Harbor 子單（docs/studio/tasks/2026-10-22-harbor-oauth-prompt-none.md）
 * 上線並讀回之後才打開。
 */
import { authRequest } from "./managed-auth";
import { oauthBaseOf } from "./provider";
import { currentLine } from "./route-lines";

export const SILENT_LOGIN_ENABLED = false;

export const SILENT_TUNING = {
  /** Harbor 探測的總預算 */
  probeMs: 1500,
  /** 每個網域多久最多試一次 */
  everyDays: 7,
  /** 登出後多久內不試 */
  loggedOutDays: 7,
} as const;

const DAY = 86_400_000;
const TRIED_KEY = "hearthroom.auth.silentTriedAt";
const LOGGED_OUT_KEY = "hearthroom.auth.loggedOutAt";
/** 上一次 Harbor 有沒有給出明確答覆（例如沒登入）：登入頁要不要多那一行說明看它 */
const RESULT_KEY = "hearthroom.auth.silentResult";
/** 這次授權是靜默的（回呼頁據此改走安靜的那條路）；只活在這個分頁 */
const FLOW_KEY = "hearthroom.auth.silentFlow";

const read = (key: string): number => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
const write = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* 隱私模式：不記，下次照樣判斷 */ } };

/** 登出時呼叫：這個網域七天內不靜默登入。 */
export function markLoggedOut(now = Date.now()): void { write(LOGGED_OUT_KEY, String(now)); }

export function silentLoginAllowed(o: { immersive: boolean; now?: number; enabled?: boolean; ua?: string }): boolean {
  const now = o.now ?? Date.now();
  if (!(o.enabled ?? SILENT_LOGIN_ENABLED) || o.immersive || !currentLine()) return false;
  if (/\bHearthroomApp\/[\d.]+\b/.test(o.ua ?? navigator.userAgent)) return false;
  if (now - read(LOGGED_OUT_KEY) < SILENT_TUNING.loggedOutDays * DAY) return false;
  return now - read(TRIED_KEY) >= SILENT_TUNING.everyDays * DAY;
}

/** Harbor 在預算內回得來嗎。跨網域、沒有 CORS 標頭，用 no-cors：只看多久回來。 */
export async function harborReachable(base: string = oauthBaseOf("harbor"), budgetMs: number = SILENT_TUNING.probeMs): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    await fetch(`${base}/?probe=${Date.now().toString(36)}`, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type SilentOutcome = "skipped" | "slow" | "started";

/** 能試就試：探 Harbor，夠快才頂層跳去授權。回傳做了什麼（started 之後頁面就離開了）。 */
export async function trySilentLogin(o: { immersive: boolean; returnTo: string; locale: string; enabled?: boolean }): Promise<SilentOutcome> {
  if (!silentLoginAllowed(o)) return "skipped";
  if (!(await harborReachable())) return "slow";
  write(TRIED_KEY, String(Date.now()));
  try { sessionStorage.setItem(FLOW_KEY, "1"); } catch { /* 回呼頁讀不到就當一般登入的失敗處理，不會循環（已記嘗試） */ }
  const { url } = await authRequest<{ url: string }>("start", { provider: "harbor", silent: true, returnTo: o.returnTo, locale: o.locale });
  location.assign(url);
  return "started";
}

/** 回呼頁：這次是不是靜默授權（讀了就清掉）。 */
export function takeSilentFlow(): boolean {
  try {
    const on = sessionStorage.getItem(FLOW_KEY) === "1";
    sessionStorage.removeItem(FLOW_KEY);
    return on;
  } catch { return false; }
}
export function rememberSilentResult(result: string): void { write(RESULT_KEY, result); }

/**
 * 登入頁要不要多一行「已在其他線路登入？從該線路的『線路』切換即可保持登入」。
 * Harbor 剛明確說過「沒登入」或靜默登入成功過時不放：那時「在別條線路登入過」多半不成立，多一句只會干擾。
 */
export function routeLoginHintVisible(o: { ua?: string } = {}): boolean {
  if (!currentLine() || /\bHearthroomApp\/[\d.]+\b/.test(o.ua ?? navigator.userAgent)) return false;
  let result = "";
  try { result = localStorage.getItem(RESULT_KEY) || ""; } catch { /* 沒有就當沒試過 */ }
  return !result;
}
