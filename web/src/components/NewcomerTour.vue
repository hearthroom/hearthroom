<script setup lang="ts">
/**
 * 新手七日每天的引導：長相沿用首次引導（CoachSpot），步驟見 lib/newcomer-tour.ts。
 * 掛在 App 上，跨頁接著走；確認框、登入框開著時先收起來。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import CoachSpot from "@/components/CoachSpot.vue";
import { NEWCOMER_TOUR, awayMode, currentStep, newcomerTour, pageOf, routeFor, stopNewcomerTour } from "@/lib/newcomer-tour";
import { fetchBoard } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";
import { findTourTarget } from "@/lib/tour-target";

const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { t, te, locale } = useI18n();

const step = computed(() => currentStep());
const steps = computed(() => NEWCOMER_TOUR[newcomerTour.day] ?? []);
const here = computed(() => pageOf(route.path));
const rect = ref<DOMRect | null>(null);
const clearRect = ref<DOMRect | null>(null);
const dialogOpen = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let scrolledFor = "";

function measure() {
  dialogOpen.value = !!document.querySelector(".dlg-backdrop, .sheet-backdrop, .stage-wrap");
  const s = step.value;
  const onPage = !!s && (s.page === "any" || s.page === pageOf(route.path));
  // 頁面自己有蘇綺的地方（簽到頁），框不到的那幾天把泡泡放在剛按的「帶我去」旁邊，不蓋頁面標題
  const anchor = s && away.value && ownSuki.value ? document.querySelector<HTMLElement>("#newcomer .nc__cta") : null;
  clearRect.value = null;
  if (anchor) { rect.value = anchor.getBoundingClientRect(); return; }
  const el = s?.target && onPage ? findTourTarget(s.target) : null;
  if (!el) { rect.value = null; return; }
  clearRect.value = (s?.clear && findTourTarget(s.clear)?.getBoundingClientRect()) || null;
  if (scrolledFor !== s!.id) { scrolledFor = s!.id; el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  rect.value = el.getBoundingClientRect();
}
onMounted(() => {
  measure();
  timer = setInterval(measure, 200);
  addEventListener("scroll", measure, { capture: true, passive: true });
  addEventListener("resize", measure);
});
onBeforeUnmount(() => { clearInterval(timer); removeEventListener("scroll", measure, { capture: true }); removeEventListener("resize", measure); });

// 不在那一頁（卡片頁、遊玩畫布不知道是哪一張，帶不過去）：泡泡照樣出現、貼在頁首底下講，不會按了沒反應
const visible = computed(() => !!step.value && !dialogOpen.value);
function go(index: number) {
  newcomerTour.index = index;
  const s = currentStep();
  if (!s) return;
  track("newcomer_tour_step", { detail: s.id });
  const to = routeFor(s, here.value);
  if (to) void router.push(lp(to));
}
// 框不到真的元素（ui.md §15.8）：卡片頁的那幾天先帶到榜單第一張卡；遊玩畫布只講位置
const away = computed(() => (step.value ? awayMode(step.value, here.value) : null));
// 頁面上已經有蘇綺插圖（簽到頁）：導覽只出泡泡，不再帶一個蘇綺（美術總監最終 r2 H4）
const ownSuki = computed(() => route.meta.petAway === true);
const copyKey = computed(() => {
  if (!step.value) return "";
  // 第 4、6 天有專門的「在卡片頁」說法；其他天（第 1 天最後一步）就用這一步自己的字，按鈕一樣是「打開一張卡」
  const awayKey = `newcomer.tour.away.${newcomerTour.day}`;
  return away.value === "card" && te(`${awayKey}.title`) ? awayKey : `newcomer.tour.${step.value.id}`;
});
const action = computed(() => (away.value === "card" ? t("newcomer.tour.openCard") : away.value === "canvas" ? t("newcomer.tour.gotIt") : undefined));
async function openCard() {
  const page = await fetchBoard({ zone: defaultZone(locale.value), limit: 1, lang: contentLang(locale.value) }).catch(() => null);
  const card = page?.items[0];
  if (card) void router.push(lp(`/cards/${card.num ?? card.id}`));
  else void router.push(lp("/"));
}
function onNext() {
  if (away.value === "card") return void openCard();
  // 「知道了」只收起泡泡；第 5 天完成與否看有沒有真的換背景或調篇幅
  if (away.value === "canvas") { track("newcomer_tour_done", { detail: String(newcomerTour.day) }); return stopNewcomerTour(); }
  next();
}
function next() { if (newcomerTour.index >= steps.value.length - 1) { track("newcomer_tour_done", { detail: String(newcomerTour.day) }); stopNewcomerTour(); } else go(newcomerTour.index + 1); }
function prev() { if (newcomerTour.index > 0) go(newcomerTour.index - 1); }
function close() { track("newcomer_tour_skip", { detail: step.value?.id ?? "" }); stopNewcomerTour(); }
</script>

<template>
  <CoachSpot
    v-if="visible && step" :rect="rect" :clear-below="clearRect" :frame="!away" :title="t(`${copyKey}.title`)" :body="t(`${copyKey}.body`)" :action="action"
    :mascot="here !== 'play' && !ownSuki" :first="newcomerTour.index === 0" :last="newcomerTour.index >= steps.length - 1" @prev="prev" @next="onNext" @close="close"
  />
</template>
