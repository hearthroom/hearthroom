<script setup lang="ts">
/**
 * 新手七日每天的引導：長相沿用首次引導（CoachSpot），步驟見 lib/newcomer-tour.ts。
 * 掛在 App 上，跨頁接著走；確認框、登入框開著時先收起來。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import CoachSpot from "@/components/CoachSpot.vue";
import { NEWCOMER_TOUR, currentStep, newcomerTour, pageOf, routeFor, stopNewcomerTour } from "@/lib/newcomer-tour";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";

const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { t } = useI18n();

const step = computed(() => currentStep());
const steps = computed(() => NEWCOMER_TOUR[newcomerTour.day] ?? []);
const here = computed(() => pageOf(route.path));
const rect = ref<DOMRect | null>(null);
const dialogOpen = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let scrolledFor = "";

function measure() {
  dialogOpen.value = !!document.querySelector(".dlg-backdrop, .sheet-backdrop, .stage-wrap");
  const s = step.value;
  const onPage = !!s && (s.page === "any" || s.page === pageOf(route.path));
  const el = s?.target && onPage ? document.querySelector<HTMLElement>(s.target) : null;
  if (!el) { rect.value = null; return; }
  if (scrolledFor !== s!.id) { scrolledFor = s!.id; el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  rect.value = el.getBoundingClientRect();
}
onMounted(() => {
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
function next() { if (newcomerTour.index >= steps.value.length - 1) { track("newcomer_tour_done", { detail: String(newcomerTour.day) }); stopNewcomerTour(); } else go(newcomerTour.index + 1); }
function prev() { if (newcomerTour.index > 0) go(newcomerTour.index - 1); }
function close() { track("newcomer_tour_skip", { detail: step.value?.id ?? "" }); stopNewcomerTour(); }
</script>

<template>
  <CoachSpot
    v-if="visible && step" :rect="rect" :title="t(`newcomer.tour.${step.id}.title`)" :body="t(`newcomer.tour.${step.id}.body`)"
    :mascot="here !== 'play'" :first="newcomerTour.index === 0" :last="newcomerTour.index >= steps.length - 1" @prev="prev" @next="next" @close="close"
  />
</template>
