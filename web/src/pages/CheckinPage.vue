<script setup lang="ts">
/**
 * 簽到頁（ui.md §3）：簽到開箱、任務、新手七日、開箱紀錄。開箱舞台疊在這頁上面，
 * 離開舞台後所有關鍵資訊（拿到什麼、幾號到期、連續幾天）都留在頁面上。
 * 資料全部來自 Harbor 應用獎勵（lib/rewards）；這頁只畫、只送領取。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import CheckinHero from "@/components/checkin/CheckinHero.vue";
import CheckinStage, { type StageMood, type StageOutcome } from "@/components/checkin/CheckinStage.vue";
import DrawHistory from "@/components/checkin/DrawHistory.vue";
import ExpiryStrip from "@/components/checkin/ExpiryStrip.vue";
import NewcomerCard from "@/components/checkin/NewcomerCard.vue";
import TaskPanel from "@/components/checkin/TaskPanel.vue";
import { useCheckin } from "@/lib/checkin-store";
import { countdown, newcomerView } from "@/lib/checkin";
import { fetchDraws, RewardsError, type DrawRecord, type RewardTask } from "@/lib/rewards";
import { confirmDialog } from "@/lib/confirm";
import { pageTitle } from "@/lib/i18n";
import { whole } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { currentReferralCode, withShareRef } from "@/lib/share-ref";
import { startNewcomerTour } from "@/lib/newcomer-tour";
import { boxKindOf, preloadPoses } from "@/lib/checkin-art";
import { noteShortfallLanding } from "@/lib/credits-recovery";

const store = useCheckin();
const session = useSession();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const { lp } = useLocalePath();

const now = ref(Date.now());
let ticker = 0;
const panel = computed(() => store.panel);
const busy = ref(false);
const toast = ref("");
let toastTimer = 0;
function say(text: string) { toast.value = text; window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast.value = ""; }, 2600); }

// ---- 開箱舞台 ----
interface StageRun { id: number; chests: string[]; request: () => Promise<StageOutcome>; checkin: boolean; source: "checkin" | "makeup" | "task" | "newcomer"; makeupDay?: string; trigger: HTMLElement | null; scrollY: number; after?: (o: StageOutcome | null, seen: boolean) => void }
const stage = shallowRef<StageRun | null>(null);
let runs = 0;
let lastOutcome: StageOutcome | null = null;
function openStage(run: Omit<StageRun, "id" | "trigger" | "scrollY">) {
  lastOutcome = null;
  stage.value = { ...run, id: ++runs, trigger: document.activeElement as HTMLElement | null, scrollY: window.scrollY };
}
async function closeStage(_mood: StageMood | null, seen: boolean) {
  const run = stage.value;
  stage.value = null;
  await refresh(true);
  run?.after?.(lastOutcome, seen);
  await nextTick();
  // 關掉後回到打開前的位置：領完頁面上方會多出東西（到期條、已領的結果），焦點回原按鈕也不准捲，
  // 不然頁面會多捲一個頁首高，「紀錄」「機率」被黏住的頁首蓋住（QA W7，接本機 Harbor 實測）
  run?.trigger?.focus?.({ preventScroll: true });
  if (run) window.scrollTo({ top: run.scrollY, behavior: "instant" as ScrollBehavior });
}

function onOpen() {
  const p = panel.value;
  if (!p) return;
  openStage({
    chests: p.checkin.todayChests,
    checkin: true,
    source: "checkin",
    request: async () => {
      const r = await store.checkin();
      return { claims: r.claims, recap: r.elsewhere, streak: r.streak };
    },
  });
}
async function onSignAnyway() {
  const f = panel.value?.checkin.fallback;
  if (!f) return;
  const ok = await confirmDialog({
    title: t("checkin.confirm.signAnyway.title"),
    message: f.checkpoint === 0 ? t("checkin.confirm.signAnyway.body.zero") : t("checkin.confirm.signAnyway.body", { checkpoint: f.checkpoint }),
    confirmText: t("checkin.confirm.signAnyway.ok"),
    cancelText: t("checkin.confirm.signAnyway.cancel"),
    focusCancel: true,
  });
  if (ok) onOpen();
}
function onMakeup() {
  const p = panel.value;
  const day = p?.checkin.makeup.repairableDays[0]?.day;
  if (!p || !day) return;
  openStage({
    chests: [p.checkin.track.find((c) => c.status === "missed")?.chest ?? "daily"],
    checkin: false,
    source: "makeup",
    makeupDay: day,
    request: async () => {
      try {
        const r = await store.makeup(day);
        return { claims: r.claims, recap: false, streak: r.streak, replayed: r.replayed };
      } catch (e) {
        if (e instanceof RewardsError && e.code === "not_eligible") say(t("checkin.makeup.error"));
        throw e;
      }
    },
    // 補簽其實上一次就成功了（逾時後重試拿到 already_claimed）：回應裡沒有新的天數，用剛重讀的面板
    // 舞台已經講了補簽、軌道也更新了：只有中途關掉舞台（已入帳但沒看到結果）才補一則 toast（ui.md §6.11）
    after: (o, seen) => { if (seen) return; const n = o && !o.replayed ? o.streak : store.panel?.checkin.streak; if (n) say(t("checkin.makeup.done", { n })); },
  });
}

// ---- 任務 ----
const claiming = ref(new Set<string>());
const failed = ref(new Set<string>());
async function claim(task: RewardTask, quiet = false): Promise<number | null> {
  if (task.reward.chest) {
    openStage({ chests: [task.reward.chest], checkin: false, source: "task", request: async () => ({ claims: [await store.claimTask(task)], recap: false }) });
    return 0;
  }
  claiming.value = new Set([...claiming.value, task.id]);
  try {
    const c = await store.claimTask(task);
    failed.value.delete(task.id);
    const amount = c.credits ?? task.reward.credits ?? 0;
    if (!quiet) say(t("task.claimed.toast", { amount: whole(amount) }));
    return amount;
  } catch {
    failed.value = new Set([...failed.value, task.id]);
    return null;
  } finally {
    const next = new Set(claiming.value); next.delete(task.id); claiming.value = next;
  }
}
/** 全部領取：依序領，最後一個提示講加總（不是只講最後一項） */
async function claimAll(tasks: RewardTask[]) {
  let sum = 0;
  for (const task of tasks) { const got = await claim(task, true); if (got === null) break; sum += got; }
  if (sum) say(t("task.claimed.toast", { amount: whole(sum) }));
  await refresh(true);
}
async function claimOne(task: RewardTask) { await claim(task); if (!task.reward.chest) await refresh(true); }
async function copyShareLink() {
  const me = session.me;
  const code = me ? await currentReferralCode(me.accountNumId) : null;
  try { await navigator.clipboard.writeText(withShareRef(location.origin + lp("/"), code)); } catch { /* 拿不到剪貼簿就算了，「更多分享方式」還在 */ }
}

// ---- 新手七日 ----
function guide(day: number) { startNewcomerTour(day, router, lp); }
/** 新手第 1–6 天：目標做到了按「領取」，積分直接入帳，不開舞台（第 7 天才開大箱） */
const newcomerClaiming = ref(false);
async function claimNewcomerDay() {
  if (newcomerClaiming.value) return;
  newcomerClaiming.value = true;
  try {
    const c = await store.claimNewcomer();
    if (c.credits != null) say(t("task.claimed.toast", { amount: whole(c.credits) }));
    await refresh(true);
  } catch {
    say(t("task.error.claim"));
  } finally {
    newcomerClaiming.value = false;
  }
}
function grand() {
  openStage({ chests: ["newcomer"], checkin: false, source: "newcomer", request: async () => ({ claims: [await store.claimNewcomer()], recap: false }) });
}

// ---- 開箱紀錄 ----
const draws = ref<DrawRecord[]>([]);
const cursor = ref<string | null>(null);
const drawsLoading = ref(false);
const drawsError = ref("");
async function loadDraws(more = false) {
  drawsLoading.value = true;
  drawsError.value = "";
  try {
    const token = await session.accessToken();
    if (!token) return;
    const res = await fetchDraws(token, more ? cursor.value ?? "" : "");
    draws.value = more ? [...draws.value, ...res.list] : res.list;
    cursor.value = res.nextCursor;
  } catch (e) {
    drawsError.value = e instanceof Error ? e.message : t("state.loadFailed");
  } finally {
    drawsLoading.value = false;
  }
}

/** settle：剛領完東西，頁首的餘額一起重讀 */
async function refresh(settle = false) {
  await Promise.all([settle ? store.settle() : store.load(), loadDraws()]);
  // 開箱要用的圖在頁面載入時就預載：按下之後不再等圖（美術總監最終 r1 M7）
  const kinds = [...new Set((store.panel?.checkin.todayChests ?? ["daily"]).map(boxKindOf))];
  void preloadPoses(kinds);
}
function onVisible() { if (document.visibilityState === "visible" && !stage.value) void store.load(); }
// 新手七日只畫一份：手機排在任務前面，桌機放右欄
const deskQuery = typeof matchMedia === "function" ? matchMedia("(min-width: 761px)") : null;
const desk = ref(!!deskQuery?.matches);
const onDesk = (e: MediaQueryListEvent) => { desk.value = e.matches; };
const hasNewcomer = computed(() => !!panel.value && !!newcomerView(panel.value));
const dailyReset = computed(() => {
  const p = panel.value;
  if (!p) return "";
  const c = countdown(p.serverNow, p.nextResetAt, store.fetchedAt, now.value);
  return t("task.reset.hours", { h: Math.max(1, c.h + (c.m > 0 ? 1 : 0)) });
});
const weeklyReset = computed(() => {
  const p = panel.value;
  if (!p) return "";
  const days = Math.max(1, Math.ceil(countdown(p.serverNow, p.weekResetAt, store.fetchedAt, now.value).totalMs / 86_400_000));
  return t("task.reset.days", { n: days }, days);
});
const expiring = computed(() => panel.value?.credits?.expiring ?? session.wallet?.expiries ?? []);
const loadError = computed(() => (!panel.value && store.error ? store.error : null));
function toTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

onMounted(() => {
  document.title = pageTitle(t("checkin.title"));
  // 從畫布「積分不夠」那張卡點「今日任務」來的：記一次點擊（B7 讀回）
  noteShortfallLanding(route, router, "checkin");
  void refresh();
  ticker = window.setInterval(() => { now.value = Date.now(); }, 30_000);
  document.addEventListener("visibilitychange", onVisible);
  deskQuery?.addEventListener("change", onDesk);
});
onBeforeUnmount(() => { window.clearInterval(ticker); window.clearTimeout(toastTimer); document.removeEventListener("visibilitychange", onVisible); deskQuery?.removeEventListener("change", onDesk); });
</script>

<template>
  <div class="page checkin">
    <header class="checkin__head">
      <h1 class="display">{{ t("checkin.title") }}</h1>
      <nav class="checkin__links">
        <a href="#history" class="link">{{ t("checkin.link.history") }}</a>
        <RouterLink :to="lp('/checkin/odds')" class="link">{{ t("checkin.link.odds") }}</RouterLink>
      </nav>
    </header>

    <ExpiryStrip class="checkin__wide" :expiring="expiring" :now="now" />

    <div v-if="loadError" class="checkin__wide panel checkin__error">
      <p class="notice notice--error"><strong>{{ t("checkin.hero.error.title") }}</strong><br />{{ t("checkin.hero.error.body") }}</p>
      <button type="button" class="btn" @click="refresh()">{{ t("checkin.cta.reload") }}</button>
    </div>
    <div v-else-if="!panel" class="checkin__wide panel checkin__skel" aria-busy="true">
      <span class="ghost" style="width:40%;height:26px" /><span class="ghost" style="width:70%;height:28px" />
      <span class="ghost" style="width:100%;height:44px" /><span class="ghost" style="width:100%;height:40px" />
    </div>
    <CheckinHero
      v-else class="checkin__wide" :panel="panel" :plan="store.plan" :fetched-at="store.fetchedAt" :now="now" :busy="busy || !!stage"
      @open="onOpen" @makeup="onMakeup" @sign-anyway="onSignAnyway"
    />

    <div v-if="panel" class="checkin__cols">
      <div class="checkin__col">
        <NewcomerCard v-if="hasNewcomer && !desk" :panel="panel" :busy="!!stage || newcomerClaiming" @guide="guide" @grand="grand" @claim="claimNewcomerDay" />
        <TaskPanel kind="daily" :tasks="panel.tasks.daily" :chest="panel.tasks.dailyAll" :plan="store.plan" :reset-label="dailyReset" :claiming="claiming" :failed="failed" @claim="claimOne" @claim-all="claimAll" @copy-link="copyShareLink" />
        <TaskPanel kind="weekly" :tasks="panel.tasks.weekly" :plan="store.plan" :reset-label="weeklyReset" :claiming="claiming" :failed="failed" @claim="claimOne" @claim-all="claimAll" @copy-link="copyShareLink" />
      </div>
      <div class="checkin__col">
        <NewcomerCard v-if="hasNewcomer && desk" :panel="panel" :busy="!!stage || newcomerClaiming" @guide="guide" @grand="grand" @claim="claimNewcomerDay" />
        <DrawHistory id="history" :list="draws" :plan="store.plan" :more="!!cursor" :loading="drawsLoading" :error="drawsError" :now="now" @more="loadDraws(true)" @retry="loadDraws()" @top="toTop" />
      </div>
    </div>

    <p class="checkin__foot subtle">{{ t("checkin.footer.reset") }} · <RouterLink :to="lp('/checkin/odds')" class="link">{{ t("checkin.footer.odds") }}</RouterLink></p>

    <CheckinStage
      v-if="stage" :key="stage.id" :chests="stage.chests" :plan="store.plan" :request="stage.request" :checkin="stage.checkin" :source="stage.source" :makeup-day="stage.makeupDay" :pity="panel?.pityRemaining"
      @settled="(o) => (lastOutcome = o)" @close="closeStage"
    />
    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.checkin { max-width:1080px; display:grid; gap:var(--s-4); padding-top:var(--s-5); padding-bottom:var(--s-7); }
.checkin__head { display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); }
.checkin__head h1 { margin:0; font-size:1.5rem; }
.checkin__links { display:flex; gap:var(--s-1); }
.checkin__links a { display:inline-flex; align-items:center; min-height:44px; padding:0 var(--s-2); font-size:14px; }
.checkin__error { padding:var(--s-4); display:grid; gap:var(--s-3); justify-items:start; }
.checkin__skel { padding:var(--s-4); display:grid; gap:var(--s-3); }
.checkin__cols { display:grid; gap:var(--s-4); }
.checkin__col { display:grid; gap:var(--s-4); align-content:start; min-width:0; }
.checkin__foot { margin:0; text-align:center; }
@media (min-width: 761px) {
  .checkin__cols { grid-template-columns:minmax(0,1fr) 380px; gap:var(--s-5); align-items:start; }
}
</style>
