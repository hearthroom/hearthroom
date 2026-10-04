import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { UpdateItem, UpdateState, UpdatesResponse } from "../../../shared/updates";
import { COMMUNITY_API } from "./config";
import { useSession } from "./session";

/**
 * 更新說明在前端的狀態：最近兩週的摘要（首頁提示列與「新」標記用）、讀者看過哪些（已讀游標）。
 *
 * 規則全在這裡（純函式，測試直接打）：
 * - 新訪客不提示：第一次見到你的時候，游標設成現在。回訪的人（帳號註冊超過一天，或這個瀏覽器
 *   早就存過本站的東西）往回算兩週，上線這套之前的更新也看得到。
 * - 提示列只為「新功能」出現，只有修正的日子不出現；關掉或點了之後 20 小時內不再出現；
 *   出現了三天都沒被理會就自己收起來，不變成牆上的常駐公告。
 * - 「新」標記：說明上線 14 天內、讀者還沒點過那個入口就掛著；同一畫面最多三個。
 *
 * 會員的狀態存在伺服器（跨裝置），訪客的存在這個瀏覽器；讀寫失敗一律當作已讀——寧可少提示一次。
 */

const HOUR = 3_600_000, DAY = 86_400_000;
export const STRIP_WINDOW = 14 * DAY;
export const STRIP_COOLDOWN = 20 * HOUR;
export const STRIP_MAX_DAYS = 3;
export const SPOTLIGHT_WINDOW = 14 * DAY;
export const SPOTLIGHT_MAX = 3;
const STORAGE_KEY = "hearthroom.updates";

export const emptyState = (seenThrough: number): UpdateState => ({ seenThrough, stripClosedAt: 0, stripDays: 0, stripDay: "", spotlights: [] });

/** 第一次見到這位讀者時的狀態。 */
export function initialState(now: number, returning: boolean): UpdateState {
  return emptyState(returning ? now - STRIP_WINDOW : now);
}

/**
 * 這個瀏覽器以前來過嗎。第一次打開時本站自己就會寫下幾個鍵（供應商、今天的到訪日），那些不算；
 * 算的是「以前某一天來過」（加到主畫面提示記的到訪日）或讀者自己做過的選擇（外觀、關過的提示、登入過）。
 */
const CHOSEN_KEYS = ["hearthroom.mode", "hearthroom.theme", "hearthroom.signedIn", "hearthroom.androidBanner.dismissedAt", "hearthroom.pwa.dismissedAt", "hearthroom.mine.shown"];
export function returningBrowser(storage: Pick<Storage, "getItem"> | null, today: string): boolean {
  if (!storage) return false;
  try {
    const days = JSON.parse(storage.getItem("hearthroom.pwa.days") || "[]") as unknown;
    if (Array.isArray(days) && days.some((d) => typeof d === "string" && d !== today)) return true;
    return CHOSEN_KEYS.some((k) => storage.getItem(k) != null);
  } catch {
    return false;
  }
}

export const localDay = (now: number) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const audienceOk = (item: UpdateItem, signedIn: boolean) => item.audience === "everyone" || signedIn;
const unseen = (items: UpdateItem[], state: UpdateState, now: number, signedIn: boolean) =>
  items.filter((i) => i.announcedAt > state.seenThrough && i.announcedAt > now - STRIP_WINDOW && i.announcedAt <= now + HOUR && audienceOk(i, signedIn));

export type StripDecision =
  | { show: false; state: UpdateState }
  | { show: true; state: UpdateState; top: UpdateItem; more: number };

/**
 * 首頁提示列現在該不該出現、出現什麼。回傳的 state 是「這次判斷之後」的狀態
 * （例如今天第一次出現就把天數加一、三天沒理會就推進游標），呼叫端照著存。
 */
export function stripDecision(items: UpdateItem[], state: UpdateState, now: number, signedIn: boolean): StripDecision {
  const fresh = unseen(items, state, now, signedIn);
  const features = fresh.filter((i) => i.tier !== "fix");
  if (!features.length) return { show: false, state };
  if (state.stripClosedAt && now - state.stripClosedAt < STRIP_COOLDOWN) return { show: false, state };
  const today = localDay(now);
  if (state.stripDay !== today && state.stripDays >= STRIP_MAX_DAYS)
    return { show: false, state: { ...state, seenThrough: now, stripDays: 0, stripDay: "" } };
  const top = [...features].sort((a, b) => Number(b.tier === "highlight") - Number(a.tier === "highlight") || b.announcedAt - a.announcedAt)[0]!;
  const next = state.stripDay === today ? state : { ...state, stripDays: state.stripDays + 1, stripDay: today };
  return { show: true, state: next, top, more: fresh.length - 1 };
}

/** 讀者表示「知道了」：關掉提示列、點了它、或打開了更新頁。 */
export const acknowledge = (state: UpdateState, now: number, closedStrip: boolean): UpdateState => ({
  ...state,
  seenThrough: Math.max(state.seenThrough, now),
  stripClosedAt: closedStrip ? now : state.stripClosedAt,
  stripDays: 0,
  stripDay: "",
});

/** 哪些「新」標記該掛：上線 14 天內、讀者還沒用過的入口，取最新的幾個。 */
export function spotlightKeys(items: UpdateItem[], state: UpdateState, now: number, signedIn: boolean, mounted: Iterable<string>): string[] {
  const used = new Set(state.spotlights);
  const newest = new Map<string, number>();
  for (const i of items) {
    if (i.announcedAt <= now - SPOTLIGHT_WINDOW || !audienceOk(i, signedIn)) continue;
    for (const key of i.spotlight) if (!used.has(key)) newest.set(key, Math.max(newest.get(key) ?? 0, i.announcedAt));
  }
  return [...new Set(mounted)].filter((k) => newest.has(k)).sort((a, b) => newest.get(b)! - newest.get(a)!).slice(0, SPOTLIGHT_MAX);
}

/** 到了某則說明「去試試」的那一頁，就當作用過它的入口。 */
export function keysForPath(items: UpdateItem[], path: string): string[] {
  const bare = (p: string) => p.replace(/[?#].*$/, "").replace(/^\/(zh-Hans|en|ja|ko)(?=\/|$)/, "").replace(/\/$/, "") || "/";
  const here = bare(path);
  return items.filter((i) => i.try && bare(i.try) === here && bare(i.try) !== "/").flatMap((i) => i.spotlight);
}

/** 兩份狀態合併（登入時：這個瀏覽器的與伺服器的）。 */
export function mergeState(a: UpdateState, b: UpdateState): UpdateState {
  return {
    seenThrough: Math.max(a.seenThrough, b.seenThrough),
    stripClosedAt: Math.max(a.stripClosedAt, b.stripClosedAt),
    stripDays: Math.max(a.stripDays, b.stripDays),
    stripDay: a.stripDay > b.stripDay ? a.stripDay : b.stripDay,
    spotlights: [...new Set([...a.spotlights, ...b.spotlights])].slice(-200),
  };
}

function readLocal(): UpdateState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<UpdateState>;
    if (typeof v.seenThrough !== "number") return null;
    return { ...emptyState(v.seenThrough), ...v, spotlights: Array.isArray(v.spotlights) ? v.spotlights.filter((k) => typeof k === "string") : [] };
  } catch {
    return null;
  }
}
function writeLocal(state: UpdateState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 存不了：這次的提示照常，下次可能再出現一次 */ }
}
function localStore(): Storage | null {
  try { return localStorage; } catch { return null; }
}

export async function fetchUpdates(locale: string, view: "summary" | "full"): Promise<UpdatesResponse> {
  const res = await fetch(`${COMMUNITY_API}/updates?lang=${encodeURIComponent(locale)}&view=${view}`);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as Partial<UpdatesResponse> | null;
  // 形狀不對（代理回了別的東西、舊版伺服器）就當作沒有說明，不讓提示列與頁面跟著壞
  if (!body || !Array.isArray(body.items)) throw new Error("updates_shape");
  return { items: body.items, stats: body.stats ?? { features: 0, fixes: 0, days: 30 } };
}

export const useUpdates = defineStore("updates", () => {
  const session = useSession();
  const items = ref<UpdateItem[]>([]);
  const state = ref<UpdateState | null>(null);
  const mounted = ref<string[]>([]);
  const now = ref(Date.now());
  let loadedLocale = "";
  let syncedMember: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const signedIn = computed(() => !!session.me);

  function ensureState(): UpdateState {
    if (state.value) return state.value;
    const local = readLocal();
    const since = session.profile?.memberSince;
    // 到訪日是 lib/pwa.ts 記的，它用 UTC 日期；這裡要用同一種日期比，不然台灣晚上第一次來的人會被當成回訪
    const returning = returningBrowser(localStore(), new Date().toISOString().slice(0, 10)) || (typeof since === "number" && since < Date.now() - DAY);
    state.value = local ?? initialState(Date.now(), returning);
    writeLocal(state.value);
    return state.value;
  }

  async function token(): Promise<string | null> {
    return session.me ? await session.accessToken() : null;
  }

  /** 登入的人：把伺服器的狀態拉下來合併；伺服器還沒有就把這個瀏覽器的交上去。 */
  async function syncMember(): Promise<void> {
    const id = session.me ? String(session.me.accountNumId) : null;
    if (!id || syncedMember === id) return;
    syncedMember = id;
    try {
      const t = await token();
      if (!t) return;
      const res = await fetch(`${COMMUNITY_API}/me/updates/state`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) return;
      const remote = ((await res.json()) as { state: UpdateState | null }).state;
      const local = ensureState();
      state.value = remote ? mergeState(local, remote) : local;
      writeLocal(state.value);
      if (!remote) scheduleSave();
    } catch { /* 下次登入再同步 */ }
  }

  function scheduleSave(): void {
    if (!session.me) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save(); }, 800);
  }
  async function save(): Promise<void> {
    try {
      const t = await token();
      if (!t || !state.value) return;
      await fetch(`${COMMUNITY_API}/me/updates/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(state.value) });
    } catch { /* 這台裝置上已經記住了；伺服器那份下次再寫 */ }
  }

  function update(next: UpdateState): void {
    const prev = state.value;
    state.value = next;
    writeLocal(next);
    if (JSON.stringify(prev) !== JSON.stringify(next)) scheduleSave();
  }

  async function load(locale: string): Promise<void> {
    ensureState();
    void syncMember();
    if (loadedLocale === locale && items.value.length) return;
    loadedLocale = locale;
    try {
      items.value = (await fetchUpdates(locale, "summary")).items;
      now.value = Date.now();
    } catch { /* 沒有摘要就不提示，頁面其他部分照常 */ }
  }

  const strip = computed(() => (state.value ? stripDecision(items.value, state.value, now.value, signedIn.value) : null));
  /** 提示列真的畫出來時呼叫：把「今天出現過」記下來。 */
  function stripShown(): void {
    const d = strip.value;
    if (d?.show) update(d.state);
  }
  /** 提示列判斷之後要自動收起的情況（三天沒理會），也要記下來。 */
  function settleStrip(): void {
    const d = strip.value;
    if (d && !d.show && d.state !== state.value) update(d.state);
  }
  function acknowledgeAll(closedStrip: boolean): void {
    update(acknowledge(ensureState(), Date.now(), closedStrip));
  }

  const spotlights = computed(() => (state.value ? spotlightKeys(items.value, state.value, now.value, signedIn.value, mounted.value) : []));
  function mount(key: string): void { mounted.value = [...mounted.value, key]; }
  function unmount(key: string): void {
    const i = mounted.value.indexOf(key);
    if (i >= 0) mounted.value = [...mounted.value.slice(0, i), ...mounted.value.slice(i + 1)];
  }
  function useSpotlight(keys: string[]): void {
    const s = ensureState();
    const fresh = keys.filter((k) => !s.spotlights.includes(k));
    if (fresh.length) update({ ...s, spotlights: [...s.spotlights, ...fresh] });
  }
  function visited(path: string): void {
    const keys = keysForPath(items.value, path);
    if (keys.length) useSpotlight(keys);
  }

  watch(() => session.me?.accountNumId ?? null, () => { syncedMember = null; void syncMember(); });

  return { items, state, strip, spotlights, load, stripShown, settleStrip, acknowledgeAll, mount, unmount, useSpotlight, visited, ensureState };
});
