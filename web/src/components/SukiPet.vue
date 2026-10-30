<script setup lang="ts">
/**
 * 桌寵兼嚮導蘇綺（設定集 docs/design/hearthroom-mascot「桌寵」各節）。
 *
 * 除了玩卡頁與沙盒（bare 路由、卡片 App 網域），站上每一頁都在，編輯頁與管理頁也算（owner 2026-10-13）。
 * 頁面載完（load 事件）、瀏覽器空閒才載入（動態 import），不拖慢第一眼；可在設定裡關掉。
 * 這裡只做「網站 → 她」的接線：她怎麼演在 pet/pet-ui.ts，各頁的用途在 pet/guides.ts。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { sidebarBoundsKey, useHeaderOverlay } from "@/lib/site-links";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { useNotifications, noticeText } from "@/lib/notifications";
import { useReviewer } from "@/lib/review";
import { resolvedMode } from "@/lib/appearance";
import { viewerAdult } from "@/lib/adult-consent";
import { fetchConversations } from "@/lib/library";
import { communityRequest } from "@/lib/community";
import { pushState } from "@/lib/push";
import { cravingKey, levelOf, localDay, type SukiNews } from "../../../shared/suki-care";
import { fetchBoard } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import { platformPath } from "@/lib/connection-ui";
import { can } from "@/lib/provider";
import { TAG_CATALOG, tagLabel } from "../../../shared/tag-catalog";
import { guideFor } from "@/pet/guides";
import {rankingClearance} from '@/pet/ranking-clearance';
import {homePhoneMode,homePhoneObstacles,type PhoneClearance} from "@/pet/home-clearance";
import {phoneControls} from "@/pet/standby-clearance";
import { petEnabled, takeSummon } from "@/pet/enabled";
import type { MenuItem, PageGuide, SukiPet as Pet } from "@/pet/pet-ui";

const props = withDefaults(defineProps<{ listEndAllowed?: boolean }>(), { listEndAllowed: true });
const sidebarBounds = inject(sidebarBoundsKey, undefined);
const sidebarMenuOpen = ref(false);
useHeaderOverlay(sidebarMenuOpen);
const route = useRoute();
const router = useRouter();
const session = useSession();
const notifications = useNotifications();
const reviewer = useReviewer();
const { t, te, locale } = useI18n();
const { lp } = useLocalePath();
const pet = shallowRef<Pet | null>(null);
const reviewingDetail = computed(()=>route.meta.managementTab==="reviews" && typeof route.params.id==="string");

/** 一句台詞：mascot.pet.<key>，有 _2 _3… 就隨機挑一句 */
function line(key: string, params: Record<string, string | number> = {}): string {
  const k = `mascot.pet.${key}`;
  if (!te(k)) return "";
  const all = [t(k, params)];
  for (let i = 2; te(`${k}_${i}`); i++) all.push(t(`${k}_${i}`, params));
  return all[Math.floor(Math.random() * all.length)];
}

async function latestChat() {
  const token = session.me ? await session.accessToken() : null;
  if (!token) return null;
  const got = await fetchConversations(token, contentLang(locale.value), 1).catch(() => null);
  return got?.conversations?.[0] ?? null;
}
async function resume() {
  try {
    const c = await latestChat();
    if (!c) return pet.value?.say(line("noChat"));
    location.href = platformPath(lp(`/play/${encodeURIComponent(c.cardNumber ?? c.conversationRoleId)}?resume=${encodeURIComponent(c.conversationId)}`), c.provider);
  } catch { pet.value?.on({ type: "hint", text: t("state.serverBusy") }); }
}
async function roll() {
  pet.value?.on({ type: "roll" });
  const page = await fetchBoard({ zone: defaultZone(locale.value), sort: "random", limit: 1, lang: contentLang(locale.value) }).catch(() => null);
  const card = page?.items[0];
  if (card) setTimeout(() => router.push(lp(`/cards/${card.num ?? card.id}`)), 700);
}
function search() {
  const box = document.querySelector<HTMLInputElement>("header input[type=search]");
  if (box && box.offsetParent) box.focus();
  else router.push(lp("/search"));
}

function menu(): MenuItem[] {
  const items: MenuItem[] = [];
  if (session.me) items.push({ label: line("menu.resume"), run: resume });
  items.push({ label: line("menu.roll"), run: roll });
  items.push({ label: line("menu.search"), run: search });
  if (notifications.unread > 0) items.push({ label: line("menu.notifications"), run: () => router.push(lp("/me/notifications")) });
  if (session.me && can("editor")) items.push({ label: line("menu.write"), run: () => router.push(lp("/create")) });
  return items;
}

/** 今天想吃的口味：跟伺服器算嘴饞加分的是同一個（shared/suki-care 的 cravingKey，照本地日期） */
function dailyTag() {
  const key = cravingKey(localDay(Date.now(), new Date().getTimezoneOffset()));
  const entry = TAG_CATALOG.find((e) => e.key === key);
  if (!entry) return null;
  return { label: tagLabel(entry, locale.value), run: () => router.push({ path: lp("/"), query: { tag: entry.key } }) };
}

/** 穿哪一套：深色主題是睡衣，18+ 打開疊上小惡魔（設定集「模式」：時段 × 18+ 兩軸） */
function skinNow(): string {
  const night = resolvedMode.value === "dark";
  const imp = !!viewerAdult(session)?.showNsfw;
  return imp ? (night ? "night-imp" : "imp") : (night ? "night" : "day");
}

function guide(path: string): PageGuide | null {
  const g = guideFor(path);
  if (!g) return null;
  const base = `guide.${g.id}`;
  const topics = [];
  for (let i = 1; i <= g.topics; i++) if (te(`mascot.pet.${base}.q${i}`)) topics.push({ q: line(`${base}.q${i}`), a: line(`${base}.a${i}`) });
  return { id: g.id, hello: line(`${base}.hello`), topics };
}

// The rail is absent below1080; its former null bounds must not let a desktop
// pet sit on the homepage filters or cards at tablet widths.
function homepageParking() {
  return petEnabled.value && innerWidth >= 640 && innerWidth < 1080
    && route.path.replace(/\/+$/, '') === lp('/').replace(/\/+$/, '');
}
function homepagePetBounds() {
  if (sidebarBounds?.value) return sidebarBounds.value;
  if (!homepageParking()) return null;
  const main = document.querySelector<HTMLElement>('.board-main');
  if (!main) return null;
  const rect = main.getBoundingClientRect();
  const header = document.querySelector('.header')?.getBoundingClientRect().bottom ?? 60;
  const top = header + 24, bottom = innerHeight - 80;
  return bottom > top ? { left: rect.left, right: rect.right, top, bottom } : null;
}

let obstacleKey="",obstacleCache:PhoneClearance|null=null;
/** 這兩頁的版面避讓之外，畫面上其他可點的東西也一起讓（其他頁由桌寵自己在待機時讓，見 standby-clearance.ts） */
function withControls(space:PhoneClearance):PhoneClearance {
 // 卡片頁的榜單避讓桌機也會用，桌機不改
 if(!(matchMedia("(pointer: coarse)").matches||innerWidth<640))return space;
 return {...space,obstacles:[...space.obstacles,...(phoneControls()?.obstacles??[])]};
}
function phoneClearance():PhoneClearance|null {
 if(!petEnabled.value)return null;
 // Read each live rect: async preferences, locale changes and scrolling alter it.
 const ranking=rankingClearance();if(ranking)return withControls(ranking);
 if(!petEnabled.value||!homePhoneMode(innerWidth,matchMedia("(pointer: coarse)").matches)||route.path.replace(/\/+$/,'')!==lp('/').replace(/\/+$/,''))return null;
 const board=document.querySelector<HTMLElement>('.board-page');
 const header=document.querySelector('.header')?.getBoundingClientRect().bottom??60;
 // The independently mounted/sticky rail can move without changing board height.
 const rail=document.querySelector('.home-sidebar')?.getBoundingClientRect();
 const key=[route.fullPath,scrollY,innerWidth,innerHeight,board?.offsetHeight,document.querySelector<HTMLElement>('.footer')?.offsetHeight,header,rail?.left,rail?.right,rail?.top,rail?.bottom].join(':');
 if(key!==obstacleKey||!obstacleCache){obstacleKey=key;obstacleCache={top:header,bottom:innerHeight,obstacles:homePhoneObstacles()};}
 return withControls(obstacleCache);
}
let pendingMenu:HTMLElement|null=null,starting=false;
function menuRequest(e:Event){
 if(route.meta.bare || route.meta.readingNotice || route.meta.petAway)return;
 const opener=(e as CustomEvent<HTMLElement|null>).detail;
 if(pet.value)pet.value.openFrom(opener);else{pendingMenu=opener;void start();}
}
let disposed = false;
async function start() {
  if(disposed||pet.value||starting)return;starting=true;
  try{
  const { SukiPet } = await import("@/pet/pet-ui");
  if (disposed || pet.value) return;
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 640;
  const p = new SukiPet({
    base: "/mascot/pet",
    skin: skinNow(),
    line,
    label: t("mascot.name"),
    height: mobile ? 132 : 220,
    mobile,
    // 手機上活動頁的主要按鈕剛好在她招呼泡泡的位置（約戰 QA 2026-10-17）：那幾頁進來時不招呼，她照常在
    // petQuiet：不分手機桌機都不招呼（錢包、機率頁的泡泡會蓋到主按鈕與紀錄，美術總監最終 r2 M8）
    canListEnd: () => props.listEndAllowed,
    sidebarBounds: homepagePetBounds,
    parkOnHomepage: homepageParking,
    phoneClearance,
    onSidebarMenuChange: open => { sidebarMenuOpen.value = open; },
    quietGreeting: () => route.meta.petQuiet === true || (mobile && route.meta.petQuietOnPhone === true),
    quietReading: () => mobile && reviewingDetail.value,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    menu,
    dailyTag,
    careVisit: async () => {
      for (let i = 0; i < 50 && !session.ready; i++) await new Promise((r) => setTimeout(r, 100));
      const token = session.me ? await session.accessToken() : null;
      if (!token) return undefined;
      const got = await communityRequest<{ state: { affection: number; fullness: number; streak: number } | null; news: SukiNews[]; recall: boolean }>("/me/suki/visit", token, "POST", { tzOffset: new Date().getTimezoneOffset() }).catch(() => null);
      if (!got?.state) return undefined;
      return { news: got.news, level: levelOf(got.state.affection), recall: got.recall, state: got.state };
    },
    enableRecall: async () => {
      const token = await session.accessToken().catch(() => null);
      if (!token) return;
      await communityRequest("/me/suki", token, "PATCH", { recall: true }).catch(() => null);
      // 召回走推播或 Discord 私訊：兩個都沒開的話，帶他去通知頁打開
      const push = await pushState(token).catch(() => "off");
      const community = await communityRequest<{ link: { state: string } | null; preferences?: { discord_dm?: number } }>("/me/community", token).catch(() => null);
      const dm = community?.link?.state === "active" && !!community.preferences?.discord_dm;
      if (push === "on" || dm) pet.value?.say(line("recallOn"));
      else pet.value?.on({ type: "hint", text: line("recallNeedsChannel"), action: { label: line("go.look"), run: () => router.push(lp("/me/notifications")) } });
    },    nickname: () => session.me?.nickName?.trim() || null,
    resume: { label: line("menu.resume"), run: resume },
    menuLabel: () => line("menu.off"),
    onOff: dismissPet,
  });
  try { await p.start(document.body); } catch { return; /* 沒有 WebGL 之類：她就不出來 */ }
  if (disposed) { p.stop(); return; }
  pet.value = p;
  // 開發時方便在主控台看她的參數
  if (import.meta.env.DEV) (window as unknown as { __suki: Pet }).__suki = p;
  enter(route.path);
  if (takeSummon()) p.on({ type: "summon" });
  if(pendingMenu){const opener=pendingMenu;pendingMenu=null;p.openFrom(opener);}
  }finally{starting=false;}
}

const offHint = ref("");
let offHintTimer: ReturnType<typeof setTimeout> | undefined;
function dismissPet() {
  offHint.value = t(session.me ? "mascot.pet.offHintMember" : "mascot.pet.offHintGuest");
  petEnabled.value = false;
  clearTimeout(offHintTimer);
  offHintTimer = setTimeout(() => { offHint.value = ""; }, 8000);
}
onBeforeUnmount(() => clearTimeout(offHintTimer));
function stop() { pet.value?.stop(); pet.value = null; }

// 她的貼圖四十多張、約 740 KB。只等閒置不夠：閒置的 3 秒時限一到，卡片頁的橫幅、封面都還在下載，
// 她跟頁面最大的那張圖搶頻寬（100257 實測 2026-10-22）。所以先等 load，再等空閒
function whenLoaded(go: () => void) {
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
onMounted(() => {
  window.addEventListener("suki-menu",menuRequest);
  if (!petEnabled.value) return;
  const go = () => void start();
  whenLoaded(() => {
    if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1500);
  });
});
onBeforeUnmount(() => { disposed = true;window.removeEventListener("suki-menu",menuRequest);stop(); });
watch(petEnabled, (on) => { if (on) void start(); else stop(); });

/** 作者工作區（編輯器）是滿版的，右下角是試聊的輸入框：進來時她先收到邊上 */
const WORKSPACE = new Set(["editor"]);
function enter(path: string) {
  // 頁面自己有蘇綺插圖的（簽到頁）：她整頁退場，離開就回來。由路由決定，因為她比頁面晚載入
  pet.value?.on({ type: "away", on: route.meta.petAway === true });
  const g = guide(path);
  if (g && WORKSPACE.has(g.id)) pet.value?.tuckAside();
  pet.value?.setGuide(g);
}
watch(() => route.path, enter);
// 她是寵物，一直都在（owner 2026-10-13）：只有玩卡頁與沙盒不出現（那兩頁根本不掛這個元件），
// 首頁面板、歡迎橫幅、新手引導在的時候也不躲。

// 網站的開關直接帶動她：深色主題、18+、語言
watch(resolvedMode, (m) => { void pet.value?.setSkin(skinNow()); pet.value?.on({ type: "theme", dark: m === "dark" }); });
watch(() => viewerAdult(session)?.showNsfw ?? false, (on, before) => { void pet.value?.setSkin(skinNow()); if (before !== undefined) pet.value?.on({ type: "adult", on }); });
watch(locale, (l) => pet.value?.on({ type: "locale", lang: String(l) }));

// 有新通知：讀最新一則，照種類演（過審慶祝、退件安慰並轉述理由、關注的作者出新卡…）
/** 說過的通知記在這台瀏覽器：重新整理不再重講同一則 */
const TOLD_KEY = "suki.told";
const told = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(TOLD_KEY) ?? "[]") as string[]; } catch { return []; } })());
function remember(id: string) {
  told.add(id);
  try { localStorage.setItem(TOLD_KEY, JSON.stringify([...told].slice(-60))); } catch { /* 存不了就只記這一頁 */ }
}
watch(() => [notifications.unread, pet.value] as const, async ([n, p], before) => {
  if (!p || n <= 0 || (before && before[0] >= n && before[1])) return;
  await notifications.load(String(locale.value)).catch(() => null);
  const fresh = notifications.items.find((x) => !x.read_at && !told.has(x.id));
  if (!fresh) return;
  remember(fresh.id);
  const go = { label: line("go.look"), run: () => router.push(fresh.path ? lp(fresh.path) : lp("/me/notifications")) };
  const rejected = fresh.kind === "review_result" && fresh.extra?.status === "rejected";
  const approved = fresh.kind === "review_result" && !rejected;
  p.on({ type: "notice", text: (approved ? line("notice.approved") : rejected ? line("notice.rejected") : "") + noticeText(fresh), mood: approved ? "party" : rejected ? "comfort" : "news", action: go });
}, { immediate: true });

// 她叫你（站內）：分頁在背景時有新通知，標題前面亮出數字；裝到主畫面的話，圖示上也標未讀數
const baseTitle = { value: "" };
watch(() => notifications.unread, (n) => {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { void (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined); } catch { /* 不支援就算了 */ }
  if (!document.hidden) return;
  const title = document.title.replace(/^\(\d+\) /, "");
  baseTitle.value = title;
  document.title = n > 0 ? `(${n}) ${title}` : title;
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && baseTitle.value) { document.title = document.title.replace(/^\(\d+\) /, ""); baseTitle.value = ""; } });

// 審核員：佇列有卡在等，一天說一次
watch(() => [reviewer.pending, pet.value, reviewingDetail.value] as const, ([n, p, reading]) => {
  if (p && n > 0 && !reading) p.on({ type: "daily", key: "review", text: line("reviewQueue", { n }), showIf:()=>!reviewingDetail.value, action: { label: line("go.look"), run: () => router.push(lp("/review")) } });
}, { immediate: true });

// 方案三天內到期：提醒一次
watch(() => [session.wallet?.plans, pet.value] as const, ([plans, p]) => {
  if (!p || !plans) return;
  const soon = plans.find((x) => x.expiresAt && x.expiresAt - Date.now() < 3 * 86_400_000 && x.expiresAt > Date.now());
  if (soon) p.on({ type: "daily", key: `plan.${soon.tier}.${soon.expiresAt}`, text: line("planEnding"), action: { label: line("go.look"), run: () => router.push(lp("/wallet")) } });
}, { immediate: true });
</script>

<template>
  <Teleport to="body"><p v-if="offHint" class="toast" role="status">{{ offHint }}</p></Teleport>
</template>

<style>
/* 桌寵的外觀（全域：她掛在 body 上，不在這個元件的 DOM 裡）。泡泡與選單固定白底深字，不跟站台主題換色 */
.suki-pet { position: fixed; left: 0; top: 0; z-index: 45; transition: transform var(--dur-base, 250ms) cubic-bezier(.25,.46,.45,.94), opacity var(--dur-base, 250ms); touch-action: none; user-select: none; -webkit-user-select: none; }
.suki-pet--sidebar-expanded { transition: opacity var(--dur-base, 250ms); }
.suki-pet--sidebar-avatar { pointer-events: none; }
.suki-pet--sidebar-avatar .suki-pet__menu, .suki-pet--sidebar-avatar .suki-pet__bubble { pointer-events: auto; }
.suki-pet--sidebar-avatar .suki-pet__canvas, .suki-pet--sidebar-avatar .suki-pet__hit { visibility: hidden; pointer-events: none; }
.suki-pet--sidebar-idle { visibility: hidden; opacity: 0; pointer-events: none; }
.suki-pet__idle { position: fixed; right: calc(8px + env(safe-area-inset-right, 0px)); bottom: calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 45; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line-strong); border-radius: 50%; background: var(--surface); box-shadow: var(--shadow-md); cursor: pointer; overflow: hidden; }
.suki-pet__idle img { display: block; width: 100%; height: 100%; object-fit: cover; }
.suki-pet__idle[hidden] { display: none !important; }
.suki-pet__idle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.suki-pet--held { transition: none; cursor: grabbing; }
/* 換衣服的那一下：縮一下再彈回來，遮住換部件的瞬間 */
.suki-pet--poof .suki-pet__canvas { animation: suki-poof 300ms cubic-bezier(.34,1.56,.64,1); transform-origin: 50% 90%; }
@keyframes suki-poof { 45% { scale: .82 1.12; opacity: .35; } }
.suki-pet--walking, .suki-pet--sliding { transition: none; }
/* 第一次出現：先隱形放到位，再從原地彈出來 */
.suki-pet--placing { transition: none !important; opacity: 0; }
.suki-pet--pop .suki-pet__canvas, .suki-pet--pop .suki-pet__hit { animation: suki-pop var(--dur-slow, 500ms) cubic-bezier(.34,1.56,.64,1); transform-origin: 50% 100%; }
@keyframes suki-pop { from { opacity: 0; scale: .5; translate: 0 24px; } }
.suki-pet--away { opacity: 0; pointer-events: none; }
.suki-pet__hit { position: relative; cursor: pointer; }
/* 畫布比她大一圈（擺盪、跳起來用），只負責畫，不接點擊 */
.suki-pet__canvas { position: absolute; display: block; pointer-events: none; }
/* 手機長按、點她時不要出現系統的選取框與藍色高亮 */
.suki-pet, .suki-pet * { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.suki-pet__hit { -webkit-user-select: none; user-select: none; outline: none; }
.suki-pet__bubble, .suki-pet__menu {
  position: absolute; bottom: calc(100% - 14px); right: 50%; transform: translateX(50%);
  width: max-content; max-width: min(260px, calc(100vw - 32px)); box-sizing: border-box;
  border-radius: 16px; background: #fff; color: #2a1d24; box-shadow: 0 10px 28px -12px rgba(0, 0, 0, .5);
}
/* 泡泡與選單自己設了 display，會蓋掉 [hidden]：一定要明講，不然設成隱藏了畫面上還在 */
.suki-pet__bubble[hidden], .suki-pet__menu[hidden] { display: none !important; }
.suki-pet__bubble { padding: 10px 14px; font-size: 13.5px; line-height: 1.55; display: grid; gap: 8px; }
.suki-pet__bubble::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 12px; height: 12px; background: #fff; transform: translateX(-50%) rotate(45deg); border-radius: 2px; }
.suki-pet__bubble--in { animation: suki-in var(--dur-base, 250ms) cubic-bezier(.25,.46,.45,.94); }
.suki-pet__go { justify-self: start; height: 30px; padding: 0 14px; border: 0; border-radius: 999px; background: #e6153f; color: #fff; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.suki-pet__menu { padding: 6px; display: grid; gap: 2px; }
.suki-pet__menu button { display: flex; align-items: center; height: 36px; padding: 0 12px; border: 0; background: transparent; color: #2a1d24; border-radius: 10px; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.suki-pet__menu button:hover, .suki-pet__menu button:focus-visible { background: rgba(42, 29, 36, .07); outline: none; }
.suki-pet--right .suki-pet__bubble, .suki-pet--right .suki-pet__menu { right: 8px; transform: none; }
.suki-pet--right .suki-pet__bubble::after { left: auto; right: calc(var(--pw, 120px) / 2 - 14px); transform: rotate(45deg); }
.suki-pet:not(.suki-pet--right) .suki-pet__bubble, .suki-pet:not(.suki-pet--right) .suki-pet__menu { right: auto; left: 8px; transform: none; }
.suki-pet:not(.suki-pet--right) .suki-pet__bubble::after { left: calc(var(--pw, 120px) / 2 - 14px); transform: rotate(45deg); }
@keyframes suki-in { from { opacity: 0; transform: translateY(6px); scale: .96; } }
/* 手機：左右各留一條邊距帶（曲面屏邊緣點不到，pet/placement.ts 的 BAND），泡泡與選單不伸進去；
   超出時 JS 把泡泡挪回帶內，--tail-dx 讓尖角還指著她 */
.suki-pet--mobile .suki-pet__bubble, .suki-pet--mobile .suki-pet__menu { max-width: min(260px, calc(100vw - max(32px, env(safe-area-inset-left, 0px)) - max(32px, env(safe-area-inset-right, 0px)))); }
.suki-pet__bubble::after { translate: var(--tail-dx, 0px) 0; }
/* 手機：她站著時螢幕邊上的細條（她住這一側；推到邊上會亮）。探出時收掉，她的身體直接貼著螢幕邊 */
.suki-pet__tab { position: fixed; left: 0; top: 0; z-index: 46; overflow: hidden; touch-action: none; border-radius: 14px 0 0 14px; background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); transition: box-shadow 160ms var(--ease), opacity var(--dur-base, 250ms); -webkit-tap-highlight-color: transparent; }
.suki-pet__tab--left { border-radius: 0 14px 14px 0; }
.suki-pet__tab--near { box-shadow: 0 0 0 2px var(--accent), var(--shadow-md); }
.suki-pet__tab--away, body:has(.header [role="menu"]) .suki-pet__tab { opacity: 0; pointer-events: none; }
/* 探出時的接觸區：透明，比她大一圈，在頁籤與她之上（還在提示與安裝提示之下） */
.suki-pet__catch { position: fixed; left: 0; top: 0; z-index: 47; touch-action: none; -webkit-tap-highlight-color: transparent; }
.suki-pet__catch[hidden], body:has(.header [role="menu"]) .suki-pet__catch { display: none; }
/* 泡泡或選單開著時她浮到接觸區上面，泡泡裡的按鈕與選單才按得到（泡泡其他地方照樣穿到接觸區，點了就是點她） */
.suki-pet--mobile:has(.suki-pet__bubble:not([hidden])), .suki-pet--mobile:has(.suki-pet__menu:not([hidden])) { z-index: 48; }
/* Desktop peeks use the rendered alpha contour too; the rectangular root must not catch its transparent holes. */
.suki-pet--tucked:not(.suki-pet--mobile) { pointer-events: none; }
.suki-pet--tucked:not(.suki-pet--mobile):not(.suki-pet--away) :is(.suki-pet__hit, .suki-pet__bubble, .suki-pet__menu) { pointer-events: auto; }
body:has(.header [role="menu"]) .suki-pet--tucked:not(.suki-pet--mobile) :is(.suki-pet__hit, .suki-pet__bubble, .suki-pet__menu) { pointer-events: none; }
/* 探出時她整個容器不接點擊，只留裁成她輪廓的接觸塊、選單與泡泡裡的按鈕：透明處的點擊落到底下的網頁（owner 2026-10-23） */
.suki-pet--mobile.suki-pet--tucked { pointer-events: none; }
.suki-pet--mobile.suki-pet--tucked:not(.suki-pet--away) .suki-pet__hit, .suki-pet--mobile.suki-pet--tucked:not(.suki-pet--away) .suki-pet__menu { pointer-events: auto; }
/* 頁首選單開著時她整個隱形（base.css）：這幾塊自己開了 auto，要一起關，不然看不見的她會擋住選單裡的「登出」 */
body:has(.header [role="menu"]) .suki-pet--mobile.suki-pet--tucked .suki-pet__hit,
body:has(.header [role="menu"]) .suki-pet--mobile.suki-pet--tucked .suki-pet__menu,
body:has(.header [role="menu"]) .suki-pet--mobile.suki-pet--tucked .suki-pet__go { pointer-events: none; }
/* 探出時泡泡壓在她頭頂那一截：點到泡泡也要算點她（只有泡泡裡的按鈕自己接） */
.suki-pet--mobile.suki-pet--tucked .suki-pet__bubble { pointer-events: none; }
.suki-pet--mobile.suki-pet--tucked:not(.suki-pet--away) .suki-pet__go { pointer-events: auto; }
/* 量 safe-area 的探針：看不見、不佔位、不接點擊 */
.suki-pet__inset { position: absolute; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
@media (prefers-reduced-motion: reduce) { .suki-pet { transition: none; } .suki-pet__bubble--in, .suki-pet--pop .suki-pet__canvas, .suki-pet--pop .suki-pet__hit { animation: none; } }
</style>

<style>
.suki-pet--phone-suspended {visibility:hidden;opacity:0;pointer-events:none;transition:opacity var(--dur),visibility 0s linear var(--dur);}
.suki-pet--phone-relocating {transition:none;}
.suki-pet--phone-dialog {pointer-events:none;}
.suki-pet--phone-dialog .suki-pet__canvas,.suki-pet--phone-dialog .suki-pet__hit {visibility:hidden;pointer-events:none;}
.suki-pet--phone-dialog .suki-pet__menu,.suki-pet--phone-dialog .suki-pet__bubble {pointer-events:auto;}
@media (prefers-reduced-motion:reduce){.suki-pet--phone-suspended {transition:none;}}
</style>
