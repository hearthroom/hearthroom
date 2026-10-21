<script setup lang="ts">
/**
 * 線路的浮層：開站後的背景測速與提示卡、線路清單、換線到站的提示。掛在 App，一次造訪一份。
 *
 * 提示卡浮在頁首區塊之下（手機整寬、桌機右上 380），不蓋導覽、不搶焦點、不自動消失；
 * 遊玩與聊天頁一律不彈也不測（owner 2026-10-22），進了那些頁就收起來。
 * 同一時間只有一個浮著的提示：它在的時候「加到主畫面」讓位（InstallToast 讀 promptShowing）。
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
// 清單只有點了入口才需要：拆成一包，不壓在每個人的第一屏上
const RoutesDialog = defineAsyncComponent(() => import("./RoutesDialog.vue"));
import RouteSpinner from "./RouteSpinner.vue";
import SignalBars from "./SignalBars.vue";
import { useRouteSwitch } from "./use-route-switch";
import {
  ROUTE_TUNING, autoPromptAllowed, backgroundCheck, currentLine, dismissPrompt, formatLatency, lineByNumber,
  openRoutesDialog, routesAvailable, routesState, signalOf, type Line,
} from "@/lib/routes";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { t } = useI18n();
const here = currentLine();
const available = routesAvailable();
const sw = useRouteSwitch("routes_prompt");
/** 遊玩頁（/play、卡片 App 網域）沉浸中不打擾；換線過場頁正在換線，也不必再測 */
const immersive = computed(() => !!route.meta.preloadStage || !!route.meta.handoff);

/** 卡片要推薦的那條：彈出時定下來，之後測速結果變了也不換（按下去失敗時要顯示的是它連不上） */
const pick = ref<Line | undefined>();
const mine = computed(() => (here ? routesState.results[here.n] : undefined));
const pickState = computed(() => (pick.value ? routesState.results[pick.value.n] : undefined));
const pickDown = computed(() => sw.failure.value === "target-down" || pickState.value?.state === "down");
const name = (n: number | undefined) => (n ? t(`routes.name.${n}`) : "");
const failureText = computed(() => {
  const args = { line: name(pick.value?.n), here: name(here?.n) };
  switch (sw.failure.value) {
    case "target-down": return session.me ? t("routes.error.targetDown", args) : t("routes.error.targetDownGuest", args);
    case "start-unavailable": return t("routes.error.startUnavailable");
    case "start-denied": return t("routes.error.startDenied", args);
    default: return "";
  }
});

let checked = false;
let idleHandle: number | undefined;
function scheduleCheck() {
  if (checked || !available) return;
  checked = true;
  const run = async () => {
    if (!autoPromptAllowed({ immersive: immersive.value })) return;
    const worth = await backgroundCheck(() => !immersive.value);
    if (!worth || routesState.promptSeen || routesState.dialogOpen || !autoPromptAllowed({ immersive: immersive.value })) return;
    pick.value = lineByNumber(routesState.recommended);
    routesState.promptShowing = true;
    routesState.promptSeen = true;
    track("routes_prompt", { detail: "shown", subject: String(routesState.recommended) });
  };
  idleHandle = typeof requestIdleCallback === "function"
    ? requestIdleCallback(() => { void run(); }, { timeout: ROUTE_TUNING.idleTimeoutMs })
    : window.setTimeout(() => { void run(); }, 1200);
}
// 直接開在遊玩頁的人：不測；之後回到其他頁才開始看。等路由真的解析完才判斷——
// 第一次導航完成之前 route 是空白的起點，看起來不像遊玩頁
void router.isReady().then(() => watch(immersive, (now) => {
  if (now) { sw.cancel(); routesState.promptShowing = false; }
  else scheduleCheck();
}, { immediate: true }));

function switchNow() {
  if (pick.value && !sw.busy.value) void sw.start(pick.value);
}
function showAll() {
  if (sw.busy.value) return;
  routesState.promptShowing = false;
  track("routes_prompt", { detail: "all", subject: String(pick.value?.n ?? "") });
  openRoutesDialog(pick.value && !pickDown.value ? pick.value.n : undefined);
  // 提示卡收起來了，清單關掉時焦點回到內容區，不掉到頁面開頭
  routesState.opener = document.querySelector<HTMLElement>("#main");
}
function later() {
  if (sw.busy.value) return;
  routesState.promptShowing = false;
  dismissPrompt();
  track("routes_prompt", { detail: "dismissed", subject: String(pick.value?.n ?? "") });
}

/*
 * 位置用量的：頁首之下；手機的「榜單／圖書館／我的」那排不是 sticky，在畫面裡時卡片在它下面，
 * 捲走之後貼回頁首下方（ui.md §4.2，美術總監 #10）。
 */
const top = ref(0);
let frame = 0;
function place() {
  frame = 0;
  const bottoms = [".header", ".mobile-library-nav"]
    .map((sel) => document.querySelector<HTMLElement>(sel))
    .filter((el): el is HTMLElement => !!el && el.offsetParent !== null)
    .map((el) => el.getBoundingClientRect().bottom);
  top.value = Math.max(0, ...bottoms);
}
const schedulePlace = () => { if (!frame) frame = requestAnimationFrame(place); };
watch(() => routesState.promptShowing, async (on) => { if (on) { await nextTick(); place(); } });
watch(() => route.fullPath, () => { void nextTick(schedulePlace); });
onMounted(() => {
  // 本機走查：從主控台直接擺出各種狀態（慢、連不上、全部連不上、切換中）
  if (import.meta.env.DEV) (window as unknown as { __routes: unknown }).__routes = { state: routesState, open: openRoutesDialog, show: (n: number) => { pick.value = lineByNumber(n); routesState.recommended = n; routesState.promptShowing = true; } };
  window.addEventListener("scroll", schedulePlace, { passive: true });
  window.addEventListener("resize", schedulePlace);
});

/* 換線到站：一次「已切換到線路三（sukisuki.chat）」 */
const arrivedText = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => routesState.arrived, (n) => {
  const line = lineByNumber(n);
  if (!line) return;
  routesState.arrived = 0;
  arrivedText.value = t("routes.arrived", { line: name(line.n), host: line.host });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { arrivedText.value = ""; }, 3200);
}, { immediate: true });

onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  if (frame) cancelAnimationFrame(frame);
  window.removeEventListener("scroll", schedulePlace);
  window.removeEventListener("resize", schedulePlace);
  if (idleHandle === undefined) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle);
  else clearTimeout(idleHandle);
});
</script>

<template>
  <Transition name="routes-prompt">
    <section
      v-if="routesState.promptShowing && pick && !immersive" class="rprompt" :style="{ top: `${top + 8}px` }"
      :aria-label="$t('routes.title')" @keydown.esc.stop="later"
    >
      <span class="rprompt__tile" aria-hidden="true"><SignalBars :level="signalOf(mine?.state === 'ok' ? mine.ms : null)" :down="mine?.state === 'down'" /></span>
      <div class="rprompt__text">
        <!-- 只讓標題與說明被朗讀：按鈕與數字每變一次都報一次只會洗版 -->
        <div role="status" aria-live="polite">
        <p class="rprompt__title">{{ pickDown ? $t("routes.prompt.failedTitle") : mine?.state === "down" ? $t("routes.prompt.downTitle") : $t("routes.prompt.slowTitle") }}</p>
        <p v-if="!pickDown" class="rprompt__body">
          <template v-if="mine?.state === 'ok'">{{ $t("routes.prompt.slowBody", { ms: formatLatency(mine.ms), line: name(pick.n) }) }}</template>
          <template v-else>{{ session.me ? $t("routes.prompt.downBody", { line: name(pick.n) }) : $t("routes.prompt.downBodyGuest", { line: name(pick.n) }) }}</template>
        </p>
        </div>
        <div class="rprompt__pick" :class="{ 'rprompt__pick--locked': sw.busy.value, 'rprompt__pick--down': pickDown }">
          <span class="rprompt__name">{{ name(pick.n) }}<span class="rprompt__host">{{ pick.host }}</span></span>
          <span class="rprompt__ms">
            <SignalBars :level="signalOf(pickState?.state === 'ok' ? pickState.ms : null)" :down="pickDown" />
            {{ pickDown ? $t("routes.down") : pickState?.state === "ok" ? formatLatency(pickState.ms) : "" }}
          </span>
        </div>
        <p v-if="sw.failure.value" class="notice rprompt__notice" :class="{ 'notice--error': sw.failure.value !== 'start-unavailable' }" role="alert">{{ failureText }}</p>
        <p v-else-if="sw.busy.value" class="rprompt__step">{{ sw.phase.value === "carrying" ? $t("routes.handoff.carrying") : $t("routes.step.connecting", { line: name(pick.n) }) }}<span v-if="sw.slow.value" class="rprompt__slow">{{ $t("routes.handoff.slow") }}</span></p>
        <div class="rprompt__actions">
          <!-- 推薦的那條連不上了：下一步是去清單選別條，不再留一顆會失敗的「切換」 -->
          <button v-if="pickDown" type="button" class="btn btn--primary btn--sm" @click="showAll">{{ $t("routes.prompt.all") }}</button>
          <template v-else>
            <button type="button" class="btn btn--primary btn--sm rprompt__go" :aria-busy="sw.busy.value || undefined" @click="switchNow">
              <RouteSpinner v-if="sw.busy.value" />{{ sw.busy.value ? $t("routes.switching") : sw.withoutLogin.value ? $t("routes.switchAnyway") : $t("routes.switchTo", { line: name(pick.n) }) }}
            </button>
            <button v-if="sw.busy.value" type="button" class="btn btn--ghost btn--sm" @click="sw.cancel()">{{ $t("dialog.cancel") }}</button>
            <button v-else type="button" class="btn btn--ghost btn--sm" @click="showAll">{{ $t("routes.prompt.all") }}</button>
          </template>
        </div>
      </div>
      <button type="button" class="btn btn--icon btn--sm btn--ghost rprompt__close" :aria-disabled="sw.busy.value || undefined" :aria-label="$t('routes.prompt.later')" :title="$t('routes.prompt.later')" @click="later">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
      </button>
    </section>
  </Transition>

  <RoutesDialog v-if="routesState.dialogOpen" />
  <div class="toast routes-toast" role="status" :hidden="!arrivedText">{{ arrivedText }}</div>
</template>

<style scoped>
/* 跟「加到主畫面」同一層（95）；top 由 place() 量出來 */
.rprompt {
  position: fixed; z-index: 95; left: var(--s-3); right: var(--s-3);
  display: flex; align-items: flex-start; gap: var(--s-3);
  padding: var(--s-4); border-radius: var(--r-lg);
  background: var(--surface); color: var(--text);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
@media (min-width: 720px) {
  .rprompt { left: auto; right: var(--s-5); width: 380px; }
}
.rprompt__tile {
  flex: none; width: 36px; height: 36px; border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-tint); color: var(--accent-text);
}
.rprompt__text { flex: 1; min-width: 0; }
.rprompt__title { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
.rprompt__body { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.rprompt__pick {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  margin-top: var(--s-3); padding: 8px 12px; border-radius: var(--r-md); background: var(--surface-2);
  transition: opacity var(--dur) var(--ease);
}
.rprompt__pick--locked { opacity: 0.5; }
.rprompt__name { display: grid; gap: 1px; min-width: 0; font-size: 14px; font-weight: 600; }
.rprompt__host { font-size: 12px; font-weight: 400; color: var(--text-2); overflow-wrap: anywhere; }
.rprompt__ms { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.rprompt__ms :deep(svg) { color: var(--text); }
.rprompt__pick--down .rprompt__ms, .rprompt__pick--down .rprompt__ms :deep(svg) { color: var(--text-3); }
.rprompt__notice { margin: var(--s-2) 0 0; font-size: 13px; }
.rprompt__step { margin: var(--s-2) 0 0; display: grid; gap: 2px; font-size: 13px; color: var(--text-2); }
.rprompt__slow { color: var(--text-3); }
.rprompt__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
.rprompt__go { gap: var(--s-2); }
.rprompt__go[aria-busy="true"] { opacity: 1; }
.rprompt__close { flex: none; margin: -6px -6px 0 0; }
.rprompt__close svg { width: 16px; height: 16px; }

/* 手機上提示卡的按鈕是這張卡的主行動，點擊區 44；✕ 外觀不變，點擊區用偽元素擴到 44 */
@media (max-width: 480px) {
  .rprompt__actions .btn { height: var(--h-lg); }
  .rprompt__close { position: relative; }
  .rprompt__close::after { content: ""; position: absolute; inset: -7px; }
}
/* .toast 從 left:50% 起算，寬度只拿得到半個螢幕：「已切換到線路三（網域）」會被擠成兩行 */
.routes-toast { width: max-content; max-width: calc(100vw - 2 * var(--s-4)); text-align: center; }
.routes-prompt-enter-active { transition: opacity var(--dur-slow) var(--ease), transform var(--dur-slow) var(--ease); }
.routes-prompt-leave-active { transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
.routes-prompt-enter-from, .routes-prompt-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
