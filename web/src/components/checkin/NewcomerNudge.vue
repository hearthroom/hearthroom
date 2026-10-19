<script setup lang="ts">
/**
 * 每天第一次進首頁，桌寵彈出的新手七日提示（ui.md §15.3、art.md §12）。
 * 卡片疊在桌寵正上方、跟著她走；沒有遮罩、不鎖捲動、不自動收起，只有兩顆按鈕。
 * 首頁常駐卡載好之後 1.2 秒才出現；彈過就記在帳號上，換裝置不重複彈。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useCheckin } from "@/lib/checkin-store";
import { newcomerView } from "@/lib/checkin";
import { loadPrompt, markPrompt, newcomerPrompt } from "@/lib/newcomer-prompt";
import { startNewcomerTour } from "@/lib/newcomer-tour";
import { tourDone } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { suki } from "@/pet/events";

const store = useCheckin();
const session = useSession();
const router = useRouter();
const { t } = useI18n();
const { lp } = useLocalePath();

const view = computed(() => (session.me && store.panel && tourDone() ? newcomerView(store.panel) : null));
const target = computed(() => store.panel?.newcomer?.today.target ?? 1);
const due = computed(() => !!view.value && !view.value.todayDone && !view.value.finished && newcomerPrompt.loaded && !newcomerPrompt.shown && !newcomerPrompt.later && !newcomerPrompt.thisVisit);
const pos = ref<{ right: number; bottom: number } | null>(null);
let timer = 0;
let follow = 0;

/** 卡片底邊＝桌寵頂邊＋10；桌寵不在（關掉了）就貼右下角。 */
function place() {
  const pet = document.querySelector<HTMLElement>(".suki-pet");
  const r = pet?.getBoundingClientRect();
  if (!r || !r.width) { pos.value = { right: 16, bottom: 16 }; return; }
  pos.value = { right: Math.max(8, innerWidth - r.right), bottom: Math.max(8, innerHeight - r.top + 10) };
}

watch(due, (now) => {
  window.clearTimeout(timer);
  if (!now) return;
  timer = window.setTimeout(async () => {
    if (!due.value || document.querySelector(".coach, .stage-wrap, .dlg-backdrop")) return;
    place();
    newcomerPrompt.showing = true;
    const token = await session.accessToken();
    if (token) void markPrompt(token, "shown");
  }, 1200);
}, { immediate: true });

// 登入狀態常常比首頁晚到：等到有人登入再讀今天彈過了沒
watch(() => session.me?.accountNumId, async (id) => {
  if (!id || newcomerPrompt.loaded) return;
  const token = await session.accessToken();
  if (token) await loadPrompt(token);
}, { immediate: true });
onMounted(() => { follow = window.setInterval(() => { if (newcomerPrompt.showing) place(); }, 500); });
onBeforeUnmount(() => { window.clearTimeout(timer); window.clearInterval(follow); newcomerPrompt.showing = false; });

function go() {
  newcomerPrompt.showing = false;
  if (view.value) startNewcomerTour(view.value.day, router, lp);
}
async function later() {
  newcomerPrompt.showing = false;
  suki({ type: "cheer", mood: "ok" });
  const token = await session.accessToken();
  if (token) void markPrompt(token, "later");
}
function onKey(e: KeyboardEvent) { if (e.key === "Escape") void later(); }
</script>

<template>
  <section
    v-if="newcomerPrompt.showing && view" class="nudge panel" role="status" :style="pos ? { right: `${pos.right}px`, bottom: `${pos.bottom}px` } : {}"
    :aria-label="t('newcomer.prompt.title', { n: view.day })" @keydown="onKey"
  >
    <span class="nudge__title">{{ t("newcomer.prompt.title", { n: view.day }) }}</span>
    <p class="nudge__line">{{ t(`newcomer.suki.${view.day}`) }}</p>
    <strong class="nudge__goal">{{ t(`newcomer.goal.${view.day}`, { n: target }, target) }}</strong>
    <button type="button" class="btn btn--primary nudge__btn" @click="go">{{ t("newcomer.prompt.go") }}</button>
    <button type="button" class="btn btn--ghost nudge__btn" @click="later">{{ t("newcomer.prompt.later") }}</button>
  </section>
</template>

<style scoped>
/* 跟桌寵同一層（45）：在頁面內容之上、在彈層與引導之下 */
.nudge {
  position:fixed; z-index:45; width:280px; padding:var(--s-3) var(--s-4) var(--s-4); display:grid; gap:var(--s-2);
  box-shadow:0 0 0 1px var(--line), var(--shadow-md); animation:nudge-in var(--dur-slow) var(--ease) both;
}
.nudge::after { content:""; position:absolute; right:40px; bottom:-7px; width:14px; height:14px; background:var(--surface); transform:rotate(45deg); box-shadow:1px 1px 0 0 var(--line); }
.nudge__title { font-size:12px; color:var(--text-2); }
.nudge__line { margin:0; font-size:13px; line-height:1.55; color:var(--text); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; text-wrap:pretty; }
.nudge__goal { font-size:13px; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.nudge__btn { width:100%; height:var(--h-lg); }
@keyframes nudge-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media (max-width: 760px) { .nudge { width:min(195px, 50vw); padding:var(--s-3); } }
@media (max-height: 480px) { .nudge__line { display:none; } }
:lang(ko) .nudge__line, :lang(ko) .nudge__goal { word-break:keep-all; }
</style>
