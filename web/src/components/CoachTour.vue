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
import { PAGE_OF, TARGET_OF, isFirst, isLast, loadProgress, nextStep, prevStep, saveProgress, stepsOf, tourState, type TourPage, type TourStep } from "@/lib/coach-tour";
import { finishTour, hasAdultStarter, isNewMember, starterFor, tourDone } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import CoachSpot from "@/components/CoachSpot.vue";
import { track } from "@/lib/track";

const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { locale } = useI18n();

const shape = reactive({ adult: false, sandbox: null as boolean | null, prologue: false, missing: [] as TourStep[] });

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
  track("tour_begin");
  go("card");
}, { immediate: true });

function go(step: TourStep | null) {
  tourState.step = step;
  persist();
  if (step) track("tour_step", { detail: step });
}

function next() {
  const step = tourState.step;
  if (!step) return;
  if (step === "card" && shape.adult) {
    go("r18");
    return;
  }
  if (step === "card" || step === "choose") {
    tourState.card = starterFor(locale.value, !!viewerAdult(session)?.showNsfw) ?? 0;
    go(firstCardStep());
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

/** 成人內容是可選的介紹：關閉提示仍可選一般卡，不會把整段引導結束。 */
function close() {
  if (tourState.step === "r18") go("choose");
  else finish("tour_skip");
}

// 成人確認成功才回到卡片；取消或驗證失敗都留在原步驟，不替使用者開啟。
watch(() => !!viewerAdult(session)?.showNsfw, (enabled) => {
  if (enabled && tourState.step === "r18") go("choose");
});

// 他直接點了框起來的東西（入門卡、「開始對話」）而不是「下一步」：一樣算往下走。
watch(() => route.path, (path) => {
  const step = tourState.step;
  const card = Number(/\/cards\/(\d+)\/?$/.exec(path)?.[1] ?? 0);
  if ((step === "r18" || step === "card" || step === "choose") && card && (card === starterFor(locale.value, false) || card === starterFor(locale.value, true))) {
    tourState.card = card;
    go(firstCardStep());
  }
  const play = Number(/\/play\/(\d+)\/?$/.exec(path)?.[1] ?? 0);
  if (step && PAGE_OF[step] === "card" && play && play === tourState.card) go("opening");
});

// ── 框的位置 ─────────────────────────────────────────────────────────────
const rect = ref<DOMRect | null>(null);
const dialogOpen = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let scrolledFor: TourStep | null = null;

/** 卡片頁的第一步：還不知道這張卡缺哪幾塊，先從分級開始，畫好之後缺的會被跳過（readCard）。 */
function firstCardStep(): TourStep {
  shape.missing = [];
  return "grade";
}
/**
 * 卡片頁：「開始對話」出現時整頁已經畫好，這時才看得出這張卡缺哪幾塊（沒有評級、沒寫介紹、不在榜沒有評分）。
 * 停在缺的那一步就跳到下一個有的。
 */
function readCard() {
  if (page.value !== "card" || !document.querySelector('[data-tour="card-play"]')) return;
  // 介紹還在路上（骨架）不算缺
  const introPending = !!document.querySelector(".role__intro-ghost");
  const missing = (["grade", "intro", "score"] as const).filter((s) =>
    !document.querySelector(TARGET_OF[s]!) && !(s === "intro" && introPending));
  if (missing.join() !== shape.missing.join()) shape.missing = missing;
  // 上一步、下一步都照 stepsOf 走，不會停在缺的那一步；只有剛進卡片頁時的第一步可能落空
  const step = tourState.step;
  if (step && shape.missing.includes(step)) go(stepsOf(shape).find((s) => PAGE_OF[s] === "card") ?? "play");
}
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
  readCard();
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
// 輪詢接頁面內容的變化；捲動要當格跟上（瀏覽器每格畫面最多送一次 scroll），只靠輪詢框會一跳一跳地追，整片遮罩跟著閃
onMounted(() => {
  measure(); timer = setInterval(measure, 200);
  addEventListener("scroll", measure, { capture: true, passive: true });
  addEventListener("resize", measure);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  removeEventListener("scroll", measure, { capture: true });
  removeEventListener("resize", measure);
});

const visible = computed(() => !!tourState.step && page.value === PAGE_OF[tourState.step] && !dialogOpen.value
  && (TARGET_OF[tourState.step] === null || !!rect.value));
const step = computed(() => tourState.step);
const copyStep = computed(() => step.value === "choose" ? "card" : step.value);
/** 首頁與卡片頁由看板娘帶；進了對話頁（舞台）就是作者的地方，泡泡維持原樣（docs/design/hearthroom-mascot）。 */
const withMascot = computed(() => page.value === "home" || page.value === "card");
</script>

<template>
  <CoachSpot
    v-if="visible && step" :rect="rect" :title="$t(`tour.${copyStep}.title`)" :body="$t(`tour.${copyStep}.body`)"
    :mascot="withMascot" :first="isFirst(step, shape)" :last="isLast(step, shape)" @prev="prev" @next="next" @close="close"
  />
</template>
