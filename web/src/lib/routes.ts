/**
 * 線路：同一個站開在四個官方網域上，連線慢的人可以換一條。
 *
 * 編號跟網域綁死（線路一＝sukisuki.ai⋯），跟 Android App 用同一套名稱與同一份清單
 * （android/routes.json，Worker 換手也讀它）；清單停用某條時那條就不出現，其餘編號不變。
 * 這裡只提示，從不替人換線（docs/studio/tasks/2026-10-22-web-routes-and-shared-login/ui.md）。
 *
 * 測速打每個網域同一個小靜態檔。別的網域沒有 CORS 標頭，用 no-cors：拿不到內容，
 * 但「多久回來」與「有沒有回來」就是我們要的全部。
 */
import { reactive } from "vue";
import { LINES, currentLine, inAndroidApp, lineByNumber, type Line } from "./route-lines";
import { authRequest, ManagedAuthUnavailable } from "./managed-auth";
import { isStandalone } from "./pwa";
import { isPlayHost } from "./site";

/** 全部可調的數字集中在這裡，QA 走查後只改這一處。 */
export const ROUTE_TUNING = {
  /** 目前線路超過這個毫秒數才算慢，才去測別條 */
  slowMs: 1200,
  /** 訊號格：低於 fastMs 三格，fastMs–slowMs 兩格，超過一格 */
  fastMs: 400,
  /** 別條要不超過目前的這個比例，而且至少快 minGainMs，才算「明顯更快」 */
  ratio: 0.6,
  minGainMs: 400,
  /** 單次測速逾時，超過算連不上 */
  probeTimeoutMs: 5000,
  /** 按下切換後再確認一次目標線路 */
  preflightTimeoutMs: 3000,
  /** 提示卡收掉後幾天內不再自動彈 */
  dismissDays: 3,
  /** 同一次造訪內，測速結果在這段時間內直接沿用 */
  reuseMs: 10 * 60_000,
  /** 開站後最晚多久開始測（閒置回呼的上限） */
  idleTimeoutMs: 3000,
  /** 切換流程超過這麼久，多一行「網路較慢」 */
  slowStepMs: 8000,
} as const;

const PROBE_PATH = "/.well-known/assetlinks.json";
const DAY = 86_400_000;
const DISMISS_KEY = "hearthroom.routes.dismissedUntil";
const PENDING_KEY = "hearthroom.routes.pending";

export { LINES, currentLine, lineByNumber, lineByOrigin, type Line } from "./route-lines";

/**
 * 這裡能不能出現線路介面。不能的地方：本機與預覽網域、卡片 App 網域、Android App 內
 * （App 有自己的線路畫面）。已安裝的主畫面 App 可以看清單，但不自動彈（autoPromptAllowed）。
 */
export function routesAvailable(o: { hostname?: string; ua?: string } = {}): boolean {
  const hostname = o.hostname ?? location.hostname;
  const ua = o.ua ?? navigator.userAgent;
  return !!currentLine(hostname) && !isPlayHost(hostname) && !inAndroidApp(ua);
}

/**
 * 開站後能不能在背景測速、慢的時候自動彈提示。遊玩與聊天頁（immersive）不打擾：
 * 不彈、不測、不放頁首圖示（owner 2026-10-22）；主畫面 App 綁定安裝時的網域，換網域體驗很差，也不彈；
 * 離線沒得比；收掉過的三天內不彈。
 */
export function autoPromptAllowed(o: { immersive: boolean }): boolean {
  return backgroundCheckAllowed(o) && !isStandalone() && !promptDismissed();
}
/** 背景測速本身：收掉提示卡之後也照樣測，頁首圖示靠它；遊玩頁與離線不測。 */
export function backgroundCheckAllowed(o: { immersive: boolean }): boolean {
  return routesAvailable() && !o.immersive && navigator.onLine !== false;
}

export type Signal = 0 | 1 | 2 | 3;
export function signalOf(ms: number | null): Signal {
  if (ms === null) return 0;
  if (ms < ROUTE_TUNING.fastMs) return 3;
  if (ms <= ROUTE_TUNING.slowMs) return 2;
  return 1;
}

/** < 1 秒寫「380 ms」（取到十位），以上寫「1.2 s」。單位是國際符號，各語言一樣。 */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.max(10, Math.round(ms / 10) * 10)} ms`;
  return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

export const isSlow = (ms: number | null): boolean => ms === null || ms >= ROUTE_TUNING.slowMs;

/**
 * 推薦哪一條：目前線路慢或連不上時，挑「明顯更快」的。多條合格取編號最小的——
 * 換到常用的那條、少換幾次網域，比再快幾百毫秒重要。
 */
export function recommend(current: Line, results: ReadonlyMap<number, number | null>): Line | undefined {
  const mine = results.get(current.n);
  if (mine === undefined || !isSlow(mine)) return undefined;
  return LINES.find((line) => {
    if (line.n === current.n) return false;
    const ms = results.get(line.n);
    if (ms === null || ms === undefined) return false;
    return mine === null || (ms <= mine * ROUTE_TUNING.ratio && mine - ms >= ROUTE_TUNING.minGainMs);
  });
}

/** 測一次：回毫秒，連不上或逾時回 null。 */
export async function probeOnce(origin: string, timeoutMs: number = ROUTE_TUNING.probeTimeoutMs): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const same = origin === location.origin;
    const res = await fetch(`${origin}${PROBE_PATH}?probe=${Date.now().toString(36)}`, {
      mode: same ? "same-origin" : "no-cors", cache: "no-store", credentials: "omit", signal: controller.signal,
    });
    if (same && !res.ok) return null;
    return performance.now() - started;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 測兩次取快的那次：第一次常常包含建立連線，第二次才是之後瀏覽的速度。
 * 第一次就連不上就不再試，免得「連不上」要等兩倍時間才顯示。
 */
export async function probeLine(origin: string, timeoutMs: number = ROUTE_TUNING.probeTimeoutMs, o: { retryDown?: boolean; keepGoing?: () => boolean } = {}): Promise<number | null> {
  const go = o.keepGoing ?? (() => true);
  if (!go()) return null;
  const first = await probeOnce(origin, timeoutMs);
  if (!go()) return first;
  if (first === null) return o.retryDown ? probeOnce(origin, timeoutMs) : null;
  const second = await probeOnce(origin, timeoutMs);
  return second === null ? first : Math.min(first, second);
}

/* ---------- 提示卡被收掉的記憶（只在這個網域；存不了就只記這次造訪） ---------- */

let dismissedInMemory = 0;
export function promptDismissed(now = Date.now()): boolean {
  let until = dismissedInMemory;
  try { until = Math.max(until, Number(localStorage.getItem(DISMISS_KEY)) || 0); } catch { /* 隱私模式 */ }
  return until > now;
}
export function dismissPrompt(now = Date.now()): void {
  dismissedInMemory = now + ROUTE_TUNING.dismissDays * DAY;
  try { localStorage.setItem(DISMISS_KEY, String(dismissedInMemory)); } catch { /* 隱私模式：這次造訪內有效 */ }
}

/* ---------- 共用狀態：提示卡、頁首圖示、對話框讀同一份 ---------- */

export type LineStatus = { state: "checking" } | { state: "ok"; ms: number } | { state: "down" };

export const routesState = reactive({
  /** 各線路最新一次結果，key 是編號 */
  results: {} as Record<number, LineStatus>,
  measuredAt: 0,
  /** 目前線路慢、而且有推薦的那條（沒有就是 0） */
  recommended: 0,
  /** 自動提示卡在畫面上 */
  promptShowing: false,
  /** 這次造訪已經彈過或看過清單：換頁不重彈 */
  promptSeen: false,
  dialogOpen: false,
  /** 對話框開啟時預選哪條 */
  preselect: 0,
  /** 從提示卡的「切換到線路三」開的：對話框一開就照預選開始切換，進度與錯誤都在對話框裡 */
  autoStart: false,
  /** 對話框開啟前的焦點，關掉時還回去 */
  opener: null as HTMLElement | null,
  /** 換手到站：要出一次「已切換」的提示（存編號） */
  arrived: 0,
  /** 換手沒帶上登入，使用者選了直接進入：頁面頂端一條說明 */
  arrivedSignedOut: false,
});

export function latencyMap(): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (const [n, s] of Object.entries(routesState.results)) {
    if (s.state === "ok") map.set(Number(n), s.ms);
    else if (s.state === "down") map.set(Number(n), null);
  }
  return map;
}

function refreshRecommendation(): void {
  const current = currentLine();
  routesState.recommended = current ? recommend(current, latencyMap())?.n ?? 0 : 0;
}

async function measure(line: Line, o: { retryDown?: boolean; keepGoing?: () => boolean } = {}): Promise<number | null> {
  if (!(line.n in routesState.results)) routesState.results[line.n] = { state: "checking" };
  const ms = typeof navigator !== "undefined" && navigator.onLine === false ? null : await probeLine(line.origin, ROUTE_TUNING.probeTimeoutMs, o);
  routesState.results[line.n] = ms === null ? { state: "down" } : { state: "ok", ms };
  refreshRecommendation();
  return ms;
}

let measuring: Promise<void> | null = null;
/** 四條一起測，各自回來各自更新。force：使用者按了「重新測速」。 */
export function measureAll(force = false): Promise<void> {
  if (measuring) return measuring;
  if (!force && routesState.measuredAt && Date.now() - routesState.measuredAt < ROUTE_TUNING.reuseMs
    && LINES.every((l) => routesState.results[l.n] && routesState.results[l.n]!.state !== "checking")) return Promise.resolve();
  if (force) for (const l of LINES) routesState.results[l.n] = { state: "checking" };
  measuring = Promise.all(LINES.map((l) => measure(l))).then(() => { routesState.measuredAt = Date.now(); }).finally(() => { measuring = null; });
  return measuring;
}

/**
 * 開站後的背景檢查：先測目前線路，夠快就到此為止（一個請求都不多打）；慢才測其他三條。
 * 回傳是否該自動彈出提示卡。
 */
export async function backgroundCheck(keepGoing: () => boolean = () => true): Promise<boolean> {
  const current = currentLine();
  if (!current) return false;
  // 目前這條兩次都失敗才算連不上（ui.md §4.1），一次閃斷不該叫人換線
  const mine = await measure(current, { retryDown: true, keepGoing });
  // 測到一半進了遊玩頁：剩下的一個都不打（每次測之前都問一次）
  if (!keepGoing() || !isSlow(mine)) return false;
  await Promise.all(LINES.filter((l) => l.n !== current.n).map((l) => measure(l, { keepGoing })));
  if (!keepGoing()) return false;
  routesState.measuredAt = Date.now();
  return routesState.recommended > 0;
}

/** 頁首訊號圖示：目前慢、有推薦、提示卡不在畫面上。 */
export function headerSignalVisible(): boolean {
  return routesState.recommended > 0 && !routesState.promptShowing;
}

export function openRoutesDialog(preselect?: number, o: { autoStart?: boolean } = {}): void {
  routesState.opener = (document.activeElement as HTMLElement | null) ?? null;
  routesState.preselect = preselect ?? currentLine()?.n ?? 0;
  routesState.autoStart = !!o.autoStart;
  routesState.dialogOpen = true;
  routesState.promptSeen = true;
}

/* ---------- 切換 ---------- */

/**
 * 頁面上有沒有還沒存的東西。沿用編輯頁既有的離開確認：它們在 beforeunload 裡、內容沒存時取消事件。
 * 這裡丟一個可取消的同名事件問一次，被取消就是有。全站只有那幾個編輯頁掛 beforeunload，問一下沒有副作用。
 */
export function hasUnsavedWork(): boolean {
  const probe = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(probe);
  return probe.defaultPrevented;
}

/** 到目標線路同一個位置的網址：路徑、查詢、語言前綴、hash 都保留，網域一律是裸網域。 */
export function targetUrl(line: Line, loc: Pick<Location, "pathname" | "search" | "hash"> = location): string {
  return `${line.origin}${loc.pathname}${loc.search}${loc.hash}`;
}

export type SwitchFailure =
  /** 目標線路現在連不上：留在原頁 */
  | "target-down"
  /** 目前線路自己不通，登入帶不過去：可以選擇不帶登入切換 */
  | "start-unavailable"
  /** 伺服器拒絕發換手（登入失效等）：顯示錯誤與重試 */
  | "start-denied";
export class SwitchError extends Error {
  constructor(public readonly kind: SwitchFailure) { super(kind); }
}

/*
 * 出發前記下要去哪條、從哪一頁出發，給原站的過場頁用。放 localStorage 而不是 sessionStorage：
 * 主畫面 App 在瀏覽器新分頁開換手，新分頁讀不到原分頁的 sessionStorage。同網域的分頁共用一份，
 * 同時換兩次的話後一次蓋前一次——伺服器那邊也是後一次取代前一次，兩邊一致。
 */
interface Pending { target: number; returnTo: string; at: number }
function rememberPending(p: Pending): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* 過場頁讀不到就只給「回到目前頁」 */ }
}
/** 換手過場頁（原站那一頁）讀：使用者剛才要去哪條、從哪一頁出發。 */
export function pendingSwitch(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null") as Pending | null;
    return p && lineByNumber(p.target) && Date.now() - p.at < 10 * 60_000 ? p : null;
  } catch { return null; }
}
export function clearPendingSwitch(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/** 已登入時先跟目前線路要一張換手單；回傳要前往的網址。 */
export async function startHandoff(line: Line, returnTo: string): Promise<string> {
  try {
    const { url } = await authRequest<{ url: string }>("route-start", { targetOrigin: line.origin, returnTo });
    if (typeof url !== "string" || !url.startsWith(`${line.origin}/`)) throw new SwitchError("start-denied");
    rememberPending({ target: line.n, returnTo, at: Date.now() });
    return url;
  } catch (e) {
    if (e instanceof SwitchError) throw e;
    if (e instanceof ManagedAuthUnavailable || e instanceof TypeError) throw new SwitchError("start-unavailable");
    throw new SwitchError("start-denied");
  }
}

/**
 * 準備切換：再確認一次目標連得上，已登入再拿換手單。回傳要前往的網址，由呼叫端 location.assign。
 * withLogin=false：未登入，或使用者選了「不帶登入切換」。
 */
export async function prepareSwitch(line: Line, o: { withLogin: boolean; loc?: Pick<Location, "pathname" | "search" | "hash">; onTargetReady?: () => void }): Promise<string> {
  const loc = o.loc ?? location;
  const ms = await probeOnce(line.origin, ROUTE_TUNING.preflightTimeoutMs);
  routesState.results[line.n] = ms === null ? { state: "down" } : { state: "ok", ms };
  refreshRecommendation();
  if (ms === null) throw new SwitchError("target-down");
  o.onTargetReady?.();
  if (!o.withLogin) return targetUrl(line, loc);
  return startHandoff(line, `${loc.pathname}${loc.search}${loc.hash}`);
}
