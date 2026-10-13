<script setup lang="ts">
/**
 * 桌寵兼嚮導蘇綺（設定集 docs/design/hearthroom-mascot「桌寵」各節）。
 *
 * 除了玩卡頁與沙盒（bare 路由、卡片 App 網域），站上每一頁都在，編輯頁與管理頁也算（owner 2026-10-13）。
 * 首屏畫完才載入（動態 import＋閒置時），不拖慢第一眼；可在設定裡關掉。
 * 這裡只做「網站 → 她」的接線：她怎麼演在 pet/pet-ui.ts，各頁的用途在 pet/guides.ts。
 */
import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { useNotifications, noticeText } from "@/lib/notifications";
import { useReviewer } from "@/lib/review";
import { resolvedMode } from "@/lib/appearance";
import { viewerAdult } from "@/lib/adult-consent";
import { fetchConversations } from "@/lib/library";
import { fetchBoard } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import { platformPath } from "@/lib/connection-ui";
import { can } from "@/lib/provider";
import { TAG_CATALOG, tagGroupOf, tagLabel } from "../../../shared/tag-catalog";
import { guideFor } from "@/pet/guides";
import { petEnabled } from "@/pet/enabled";
import type { MenuItem, PageGuide, SukiPet as Pet } from "@/pet/pet-ui";

const route = useRoute();
const router = useRouter();
const session = useSession();
const notifications = useNotifications();
const reviewer = useReviewer();
const { t, te, locale } = useI18n();
const { lp } = useLocalePath();
const pet = shallowRef<Pet | null>(null);

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
  const c = await latestChat();
  if (!c) return pet.value?.say(line("noChat"));
  location.href = platformPath(lp(`/play/${encodeURIComponent(c.cardNumber ?? c.conversationRoleId)}?resume=${encodeURIComponent(c.conversationId)}`), c.provider);
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
  if (session.me) items.push({ label: line("menu.resume"), run: () => void resume() });
  items.push({ label: line("menu.roll"), run: () => void roll() });
  items.push({ label: line("menu.search"), run: search });
  if (notifications.unread > 0) items.push({ label: line("menu.notifications"), run: () => router.push(lp("/me/notifications")) });
  if (session.me && can("editor")) items.push({ label: line("menu.write"), run: () => router.push(lp("/create")) });
  return items;
}

/** 今天的幸運類型：只從玩法與題材兩組挑（不挑成人向那組），每天固定 */
function dailyTag() {
  const pool = TAG_CATALOG.filter((e) => ["play", "setting"].includes(tagGroupOf(e.key) ?? ""));
  if (!pool.length) return null;
  const d = new Date();
  const entry = pool[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % pool.length];
  return { label: tagLabel(entry, locale.value), run: () => router.push({ path: lp("/"), query: { tag: entry.key } }) };
}

function guide(path: string): PageGuide | null {
  const g = guideFor(path);
  if (!g) return null;
  const base = `guide.${g.id}`;
  const topics = [];
  for (let i = 1; i <= g.topics; i++) if (te(`mascot.pet.${base}.q${i}`)) topics.push({ q: line(`${base}.q${i}`), a: line(`${base}.a${i}`) });
  return { id: g.id, hello: line(`${base}.hello`), topics };
}

let disposed = false;
async function start() {
  const { SukiPet } = await import("@/pet/pet-ui");
  if (disposed || pet.value) return;
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 640;
  const p = new SukiPet({
    base: "/mascot/pet",
    skins: ["day"],
    line,
    label: t("mascot.name"),
    height: mobile ? 132 : 220,
    mobile,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    menu,
    dailyTag,
    lastStoryAt: async () => {
      for (let i = 0; i < 50 && !session.ready; i++) await new Promise((r) => setTimeout(r, 100));
      if (!session.me) return undefined;
      const c = await latestChat(); const at = Date.parse(c?.lastChatTime || c?.createTime || "");
      return Number.isFinite(at) ? at : null;
    },
    nickname: () => session.me?.nickName?.trim() || null,
    resume: { label: line("menu.resume"), run: () => void resume() },
    menuLabel: () => line("menu.off"),
    onOff: () => { petEnabled.value = false; },
  });
  try { await p.start(document.body); } catch { return; /* 沒有 WebGL 之類：她就不出來 */ }
  if (disposed) { p.stop(); return; }
  pet.value = p;
  // 開發時方便在主控台看她的參數
  if (import.meta.env.DEV) (window as unknown as { __suki: Pet }).__suki = p;
  enter(route.path);
}

function stop() { pet.value?.stop(); pet.value = null; }

onMounted(() => {
  if (!petEnabled.value) return;
  const go = () => void start();
  if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1500);
});
onBeforeUnmount(() => { disposed = true; stop(); });
watch(petEnabled, (on) => { if (on) void start(); else stop(); });

/** 作者工作區（編輯器）是滿版的，右下角是試聊的輸入框：進來時她先收到邊上 */
const WORKSPACE = new Set(["editor"]);
function enter(path: string) {
  const g = guide(path);
  if (g && WORKSPACE.has(g.id)) pet.value?.tuckAside();
  pet.value?.setGuide(g);
}
watch(() => route.path, enter);
// 畫面上已經有她（首頁面板、歡迎橫幅、新手引導框）時桌寵先躲開，一次只出現一個；捲過去她才從角落出來
const stageVisible = shallowRef(false);
let stageObserver: IntersectionObserver | null = null;
const seen = new Set<Element>();
function watchStages() {
  stageObserver?.disconnect(); seen.clear();
  stageObserver = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); }
    stageVisible.value = seen.size > 0;
  });
  for (const el of document.querySelectorAll("[data-suki-stage]")) stageObserver.observe(el);
  if (!document.querySelector("[data-suki-stage]")) stageVisible.value = false;
}
// 面板等登入狀態到了才畫出來：換頁、身分到了都重新找一次，晚一點再補找一次
// 面板、引導框是之後才畫出來的：頁面上多了或少了這種東西就重新找（合併成一次）
let rescan = 0;
const domObserver = new MutationObserver((records) => {
  // 她自己的泡泡在變，不算
  if (records.every((r) => (r.target as Element).closest?.(".suki-pet"))) return;
  clearTimeout(rescan); rescan = window.setTimeout(watchStages, 300);
});
watch(pet, (p) => { domObserver.disconnect(); if (p) { domObserver.observe(document.body, { childList: true, subtree: true }); watchStages(); } }, { immediate: true });
onBeforeUnmount(() => { stageObserver?.disconnect(); domObserver.disconnect(); clearTimeout(rescan); });
watch(() => [stageVisible.value, pet.value] as const, ([stage, p]) => p?.setAway(stage), { immediate: true });

// 網站的開關直接帶動她：深色主題、18+、語言
watch(resolvedMode, (m) => pet.value?.on({ type: "theme", dark: m === "dark" }));
watch(() => viewerAdult(session)?.showNsfw ?? false, (on, before) => { if (before !== undefined) pet.value?.on({ type: "adult", on }); });
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

// 審核員：佇列有卡在等，一天說一次
watch(() => [reviewer.pending, pet.value] as const, ([n, p]) => {
  if (p && n > 0) p.on({ type: "daily", key: "review", text: line("reviewQueue", { n }), action: { label: line("go.look"), run: () => router.push(lp("/review")) } });
}, { immediate: true });

// 方案三天內到期：提醒一次
watch(() => [session.wallet?.plans, pet.value] as const, ([plans, p]) => {
  if (!p || !plans) return;
  const soon = plans.find((x) => x.expiresAt && x.expiresAt - Date.now() < 3 * 86_400_000 && x.expiresAt > Date.now());
  if (soon) p.on({ type: "daily", key: `plan.${soon.tier}.${soon.expiresAt}`, text: line("planEnding"), action: { label: line("go.look"), run: () => router.push(lp("/wallet")) } });
}, { immediate: true });
</script>

<template>
  <span hidden />
</template>

<style>
/* 桌寵的外觀（全域：她掛在 body 上，不在這個元件的 DOM 裡）。泡泡與選單固定白底深字，不跟站台主題換色 */
.suki-pet { position: fixed; left: 0; top: 0; z-index: 45; transition: transform var(--dur-base, 250ms) cubic-bezier(.25,.46,.45,.94), opacity var(--dur-base, 250ms); touch-action: none; user-select: none; -webkit-user-select: none; }
.suki-pet--held { transition: none; cursor: grabbing; }
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
@keyframes suki-in { from { opacity: 0; translate: 0 6px; scale: .96; } }
@media (prefers-reduced-motion: reduce) { .suki-pet { transition: none; } .suki-pet__bubble--in { animation: none; } }
</style>
