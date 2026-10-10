<script setup lang="ts">
/**
 * 首頁的新手引導（owner 2026-10-10，參考魅魔島：第一次來就帶進一張卡）。
 * 只給第一次來、還沒登入的訪客；這個語言沒設入門卡（shared/starter-cards.ts）就不出現。
 *   1. 這組有成人版：先指出頁首的 R18（頁首那顆會亮起來），確認年齡之後就看得到成人內容。
 *   2. 指向入門卡，「開始玩」直接進對話頁：開了成人內容進成人版，沒開進一般版。
 * 不擋畫面：貼底的一張小卡，榜單照樣能滑能點。略過或開始玩之後，這台裝置不再出現。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { fetchCard } from "@/lib/api";
import { guestAdult, loadGuestAdult, viewerAdult } from "@/lib/adult-consent";
import { contentLang } from "@/lib/i18n";
import { finishTour, hasAdultStarter, starterFor, tourDone, tourFocus } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";

const session = useSession();
const router = useRouter();
const { lp } = useLocalePath();
const { locale } = useI18n();

const dismissed = ref(tourDone());
/** R18 那一步要等知道頁首有沒有那顆鈕（站上發得出遊客憑證才有），沒有就不提它，直接指向入門卡。 */
const step = ref<"adult" | "start" | null>(null);
const general = computed(() => starterFor(locale.value, false));
const open = computed(() => !dismissed.value && session.ready && !session.me && !!general.value);
const name = ref("");

watch(open, async (now) => {
  if (!now) { tourFocus.value = ""; return; }
  await loadGuestAdult();
  step.value = hasAdultStarter(locale.value) && guestAdult.available && !guestAdult.showNsfw ? "adult" : "start";
  track("tour_open", { detail: step.value });
}, { immediate: true });
// 介紹的是「開始玩」會打開的那張：走到這一步時看他開了成人內容沒（R18 那一步可能剛開）。
watch(step, (now) => {
  if (now !== "start") return;
  const card = starterFor(locale.value, !!viewerAdult(session)?.showNsfw);
  name.value = "";
  void fetchCard(String(card), contentLang(locale.value), { quiet: true })
    .then((c) => { name.value = c.name ?? ""; }, () => {});
});
watch([open, step], () => { tourFocus.value = open.value && step.value === "adult" ? "r18" : ""; }, { immediate: true });
onBeforeUnmount(() => { tourFocus.value = ""; });

function skip() {
  track("tour_skip", { detail: step.value ?? "" });
  finishTour();
  dismissed.value = true;
}
function start() {
  const adult = !!viewerAdult(session)?.showNsfw;
  const card = starterFor(locale.value, adult);
  finishTour();
  dismissed.value = true;
  track("tour_start", { subject: String(card), detail: adult ? "adult" : "general" });
  void router.push(lp(`/play/${card}`));
}
</script>

<template>
  <aside v-if="open && step" class="tour panel" aria-live="polite">
    <template v-if="step === 'adult'">
      <h2 class="tour__title">{{ $t("tour.adult.title") }}</h2>
      <p class="tour__body">{{ $t("tour.adult.body") }}</p>
      <div class="tour__actions">
        <button type="button" class="btn btn--ghost" @click="skip">{{ $t("tour.skip") }}</button>
        <button type="button" class="btn btn--primary" @click="step = 'start'">{{ $t("tour.next") }}</button>
      </div>
    </template>
    <template v-else>
      <h2 class="tour__title">{{ $t("tour.start.title") }}</h2>
      <p v-if="name" class="tour__body">{{ $t("tour.start.body", { name }) }}</p>
      <div class="tour__actions">
        <button type="button" class="btn btn--ghost" @click="skip">{{ $t("tour.skip") }}</button>
        <button type="button" class="btn btn--primary" @click="start">{{ $t("tour.start.go") }}</button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.tour {
  position: fixed; z-index: 30;
  left: 50%; transform: translateX(-50%);
  bottom: calc(var(--s-4) + env(safe-area-inset-bottom));
  width: min(420px, calc(100% - 2 * var(--s-4)));
  padding: var(--s-4); display: grid; gap: var(--s-2);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.tour__title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.tour__body { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.tour__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }
</style>
