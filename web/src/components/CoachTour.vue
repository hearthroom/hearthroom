<script setup lang="ts">
/**
 * 新手引導（owner 2026-10-10，照魅魔島）：一頁一頁框出要點的地方，按「下一步」自動跳頁，
 * 從首頁一路帶到入門卡的對話頁。步驟見 lib/coach-tour.ts，誰看得到見 lib/onboarding.ts。
 *
 * 掛在 App 上，跨頁接著走。框起來的地方照樣能點（例如頁首的 R18），遮罩不擋操作。
 * 對話框（年齡聲明、登入框）開著時先收起來，關掉再出現。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { guestAdult, loadGuestAdult, viewerAdult } from "@/lib/adult-consent";
import { PAGE_OF, TARGET_OF, isFirst, isLast, loadProgress, nextStep, prevStep, saveProgress, tourState, type TourPage, type TourStep } from "@/lib/coach-tour";
import { finishTour, hasAdultStarter, isNewMember, starterFor, tourDone } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";

const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { locale } = useI18n();

const shape = reactive({ adult: false, sandbox: null as boolean | null, prologue: false });

const restored = loadProgress();
if (restored) { tourState.step = restored.step; tourState.card = restored.card; shape.adult = restored.adult; }
function persist() {
  saveProgress(tourState.step ? { step: tourState.step, card: tourState.card, adult: shape.adult } : null);
}

/** 現在在哪一頁；卡片頁與對話頁要是入門卡那一張才算。 */
const page = computed<TourPage | null>(() => {
  const path = route.path.replace(/\/+$/, "");
  if (path === lp("/").replace(/\/+$/, "")) return "home";
  const card = /\/cards\/(\d+)$/.exec(path)?.[1];
  if (card && Number(card) === tourState.card) return "card";
  const play = /\/play\/(\d+)$/.exec(path)?.[1];
  if (play && Number(play) === tourState.card) return "play";
  return null;
});

// 開始：首頁、新用戶、這台裝置沒看過、這個語言有入門卡
const newcomer = computed(() => !session.me || (!!session.profile && isNewMember(session.profile.memberSince)));
const eligible = computed(() => !tourState.step && !tourDone() && session.ready && newcomer.value && page.value === "home" && !!starterFor(locale.value, false));
watch(eligible, async (now) => {
  if (!now) return;
  if (!session.me) await loadGuestAdult();
  const adult = viewerAdult(session);
  shape.adult = hasAdultStarter(locale.value) && (!!session.me || guestAdult.available) && !!adult && !adult.showNsfw;
  if (!eligible.value) return;
  go(shape.adult ? "r18" : "card");
}, { immediate: true });

function go(step: TourStep | null) {
  tourState.step = step;
  persist();
  if (step) track("tour_step", { detail: step });
}

function next() {
  const step = tourState.step;
  if (!step) return;
  if (step === "card") {
    tourState.card = starterFor(locale.value, !!viewerAdult(session)?.showNsfw) ?? 0;
    go("intro");
    void router.push(lp(`/cards/${tourState.card}`));
    return;
  }
  if (step === "play") {
    go("opening");
    void router.push(lp(`/play/${tourState.card}`));
    return;
  }
  const following = nextStep(step, shape);
  if (following) go(following); else finish("tour_done");
}

function prev() {
  const step = tourState.step;
  if (!step) return;
  const before = prevStep(step, shape);
  if (!before) return;
  go(before);
  if (PAGE_OF[before] !== PAGE_OF[step]) {
    void router.push(lp(PAGE_OF[before] === "home" ? "/" : `/cards/${tourState.card}`));
  }
}

function finish(event: "tour_done" | "tour_skip") {
  track(event, { detail: tourState.step ?? "" });
  finishTour();
  tourState.step = null;
  tourState.card = 0;
  persist();
}

// 他直接點了框起來的東西（入門卡、「開始對話」）而不是「下一步」：一樣算往下走。
watch(() => route.path, (path) => {
  const step = tourState.step;
  const card = Number(/\/cards\/(\d+)\/?$/.exec(path)?.[1] ?? 0);
  if ((step === "r18" || step === "card") && card && (card === starterFor(locale.value, false) || card === starterFor(locale.value, true))) {
    tourState.card = card;
    go("intro");
  }
  const play = Number(/\/play\/(\d+)\/?$/.exec(path)?.[1] ?? 0);
  if ((step === "intro" || step === "play") && play && play === tourState.card) go("opening");
});

// ── 框的位置 ─────────────────────────────────────────────────────────────
const rect = ref<DOMRect | null>(null);
const dialogOpen = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let scrolledFor: TourStep | null = null;

/** 對話頁：舞台掛好才知道是同層卡還是一般卡、有沒有開場選項。 */
function readStage() {
  if (page.value !== "play") return;
  // 同層卡：整個對話區是沙箱 iframe（舞台公開給作者的 data-lt 標記）
  const sandbox = !!document.querySelector('[data-lt="sandbox-frame"]');
  const message = !!document.querySelector('[data-lt="message"]');
  if (!sandbox && !message) return;
  shape.sandbox = sandbox;
  shape.prologue = !!document.querySelector('[data-lt="prologue"]');
  if (sandbox && tourState.step === "opening") go("stage");
}

function measure() {
  dialogOpen.value = !!document.querySelector(".dlg-backdrop, .sheet-backdrop");
  readStage();
  const step = tourState.step;
  const selector = step ? TARGET_OF[step] : null;
  const el = selector ? document.querySelector<HTMLElement>(selector) : null;
  if (!el) { rect.value = null; return; }
  if (scrolledFor !== step) {
    scrolledFor = step;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  rect.value = el.getBoundingClientRect();
}
onMounted(() => { measure(); timer = setInterval(measure, 200); });
onBeforeUnmount(() => clearInterval(timer));

const visible = computed(() => !!tourState.step && page.value === PAGE_OF[tourState.step] && !dialogOpen.value
  && (TARGET_OF[tourState.step] === null || !!rect.value));
const PAD = 8;
const hole = computed(() => rect.value && {
  top: `${rect.value.top - PAD}px`, left: `${rect.value.left - PAD}px`,
  width: `${rect.value.width + PAD * 2}px`, height: `${rect.value.height + PAD * 2}px`,
});
/** 框在上半部就把說明放在框的下面，反之放上面；框不到（同層卡）就放在頁首底下，不蓋住卡自己底部的按鈕。 */
const bubbleStyle = computed(() => {
  const r = rect.value;
  if (!r) return { top: `calc(64px + env(safe-area-inset-top))` };
  const below = r.top + r.height / 2 < window.innerHeight / 2;
  return below ? { top: `${Math.min(r.bottom + PAD + 12, window.innerHeight - 200)}px` } : { bottom: `${Math.min(window.innerHeight - r.top + PAD + 12, window.innerHeight - 200)}px` };
});
const step = computed(() => tourState.step);
</script>

<template>
  <div v-if="visible && step" class="coach" aria-live="polite">
    <div v-if="hole" class="coach__hole" :style="hole" />
    <section class="coach__bubble panel" :style="bubbleStyle" role="dialog" aria-labelledby="coach-title">
      <button type="button" class="coach__close" :aria-label="$t('tour.skip')" @click="finish('tour_skip')">×</button>
      <h2 id="coach-title" class="coach__title">{{ $t(`tour.${step}.title`) }}</h2>
      <p class="coach__body">{{ $t(`tour.${step}.body`) }}</p>
      <div class="coach__actions">
        <button v-if="!isFirst(step, shape)" type="button" class="btn btn--ghost" @click="prev">{{ $t("tour.prev") }}</button>
        <button type="button" class="btn btn--primary" @click="next">{{ $t(isLast(step, shape) ? "tour.done" : "tour.next") }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 層級：在舞台（最高 100）之上，在年齡聲明與確認框之下（那兩個開著時引導先收起來） */
.coach { position: fixed; inset: 0; z-index: 101; pointer-events: none; }
.coach__hole {
  position: fixed; border-radius: var(--r-md);
  box-shadow: 0 0 0 9999px rgba(16, 16, 24, 0.55), 0 0 0 3px var(--accent);
  transition: top var(--dur) var(--ease), left var(--dur) var(--ease), width var(--dur) var(--ease), height var(--dur) var(--ease);
}
.coach__bubble {
  position: fixed; left: 50%; transform: translateX(-50%);
  width: min(380px, calc(100% - 2 * var(--s-4)));
  padding: var(--s-4); display: grid; gap: var(--s-2);
  pointer-events: auto; box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.coach__close {
  position: absolute; top: var(--s-2); right: var(--s-2);
  width: 32px; height: 32px; border: 0; border-radius: var(--r-pill);
  background: transparent; color: var(--text-3); font-size: 20px; line-height: 1; cursor: pointer;
}
.coach__title { margin: 0; padding-right: var(--s-6); font-size: 16px; font-weight: 600; line-height: 1.4; }
.coach__body { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.coach__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }
</style>
