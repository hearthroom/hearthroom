<script setup lang="ts">
/**
 * 今日任務／本週任務（ui.md §4）。可領的整列淡底加「領取」，不用實心按鈕，免得跟簽到主按鈕搶。
 * 寶箱任務按下去開同一個開箱舞台；伺服器說不適用的整列不出現。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import CreditIcon from "./CreditIcon.vue";
import { taskView, chestTitle, type TaskView } from "@/lib/checkin";
import { whole } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import type { RewardPlan, RewardTask } from "@/lib/rewards";

const props = defineProps<{
  kind: "daily" | "weekly";
  tasks: RewardTask[];
  chest?: RewardTask | null;
  plan: RewardPlan | null;
  resetLabel: string;
  claiming: Set<string>;
  failed: Set<string>;
}>();
const emit = defineEmits<{ claim: [task: RewardTask]; claimAll: [tasks: RewardTask[]]; copyLink: [] }>();
const { t } = useI18n();
const { lp } = useLocalePath();

const rows = computed(() => props.tasks.map((task) => ({ task, view: taskView(task) })).filter((r): r is { task: RewardTask; view: TaskView } => !!r.view));
const done = computed(() => rows.value.filter((r) => r.task.status === "claimed").length);
const claimable = computed(() => rows.value.filter((r) => r.task.status === "claimable" && !r.view.chest).map((r) => r.task));
const copied = ref(false);

const DEST: Record<string, string> = { chat: "/library", tryNew: "/", comment: "/library", rate: "/library", reply: "/mine" };
const titleOf = (r: { task: RewardTask; view: TaskView }) => {
  if (r.view.chest && r.task.reward.chest) { const c = chestTitle(r.task.reward.chest, props.plan); return t(c.key, c.params ?? {}); }
  return t(r.view.title, { n: r.task.target, min: r.task.target });
};
const rowTitle = (r: { task: RewardTask; view: TaskView }) => (r.view.chest ? t(r.view.title, { n: r.task.target }) : titleOf(r));
const progressOf = (r: { task: RewardTask; view: TaskView }) => t(r.view.progress, { cur: whole(r.task.progress), max: whole(r.task.target) }, r.task.target);
const ratio = (task: RewardTask) => (task.target ? Math.min(1, task.progress / task.target) : 0);
async function copy() {
  emit("copyLink");
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}
defineExpose({ copied });
</script>

<template>
  <section v-if="rows.length || chest" :id="kind === 'daily' ? 'tasks' : undefined" class="tasks panel" :aria-labelledby="`tasks-${kind}`">
    <header class="tasks__head">
      <h2 :id="`tasks-${kind}`">{{ t(kind === "daily" ? "task.section.daily" : "task.section.weekly") }}
        <span class="tasks__count">{{ t("task.section.count", { done, total: rows.length }) }}</span></h2>
      <span class="tasks__reset">{{ resetLabel }}</span>
      <button v-if="claimable.length >= 2" type="button" class="btn btn--ghost btn--sm" @click="emit('claimAll', claimable)">{{ t("task.claimAll") }}</button>
    </header>
    <ul class="tasks__list">
      <li v-for="r in rows" :key="r.task.id" class="task" :class="{ 'task--claimable': r.task.status === 'claimable', 'task--claimed': r.task.status === 'claimed' }">
        <span class="task__icon" aria-hidden="true">
          <svg v-if="r.view.chest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5" /></svg>
          <svg v-else-if="r.view.action === 'copyLink'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
        </span>
        <span class="task__main">
          <span class="task__title">{{ rowTitle(r) }}</span>
          <span class="meter" :class="{ 'meter--done': r.task.status === 'claimed' || r.task.status === 'claimable' }" role="progressbar" :aria-valuenow="r.task.progress" aria-valuemin="0" :aria-valuemax="r.task.target" :aria-label="progressOf(r)"><i :style="{ '--v': ratio(r.task) }" /></span>
          <span class="task__progress">{{ progressOf(r) }}</span>
          <RouterLink v-if="r.view.action === 'copyLink' && r.task.status === 'locked'" :to="lp('/me/referral')" class="task__more link">{{ t("task.cta.moreShare") }}</RouterLink>
          <span v-if="failed.has(r.task.id)" class="task__error notice--error" role="alert">{{ t("task.error.claim") }}</span>
        </span>
        <span class="task__side">
          <span v-if="r.task.reward.credits" class="task__reward"><CreditIcon />+{{ whole(r.task.reward.credits) }}</span>
          <span v-if="r.task.status === 'claimed'" class="task__done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>{{ t("task.status.claimed") }}</span>
          <span v-else-if="r.task.status === 'pending'" class="task__done">{{ t("wallet.record.pending") }}</span>
          <button v-else-if="r.task.status === 'claimable' || failed.has(r.task.id)" type="button" class="btn btn--sm task__claim" :disabled="claiming.has(r.task.id)" :aria-busy="claiming.has(r.task.id)" @click="emit('claim', r.task)">
            <span v-if="claiming.has(r.task.id)" class="spin" aria-hidden="true" />
            <span :class="{ 'task__hold': claiming.has(r.task.id) }">{{ failed.has(r.task.id) ? t("task.cta.retry") : r.view.chest ? t("task.cta.openChest") : t("task.cta.claim") }}</span>
          </button>
          <button v-else-if="r.view.action === 'copyLink'" type="button" class="btn btn--sm" @click="copy">{{ copied ? t("task.cta.copied") : t("task.cta.copyLink") }}</button>
          <span v-else-if="r.view.chest" class="task__lock" :aria-label="t('task.status.locked')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>
          <RouterLink v-else :to="lp(DEST[r.view.action] ?? '/')" class="btn btn--sm">{{ t(r.view.cta) }}</RouterLink>
        </span>
      </li>
      <li v-if="chest" class="task task--chest" :class="{ 'task--claimable': chest.status === 'claimable', 'task--claimed': chest.status === 'claimed' }">
        <span class="task__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5" /></svg></span>
        <span class="task__main">
          <span class="task__title">{{ t("task.chest.title") }}</span>
          <span class="meter meter--done" role="progressbar" :aria-valuenow="chest.progress" aria-valuemin="0" :aria-valuemax="chest.target"><i :style="{ '--v': ratio(chest) }" /></span>
          <span class="task__progress">{{ chest.status === "locked" ? t("task.chest.left", { n: chest.target - chest.progress }, chest.target - chest.progress) : t("task.section.count", { done: chest.progress, total: chest.target }) }}</span>
        </span>
        <span class="task__side">
          <span v-if="chest.status === 'claimed'" class="task__done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>{{ t("task.status.claimed") }}</span>
          <button v-else-if="chest.status === 'claimable' || failed.has(chest.id)" type="button" class="btn btn--sm task__claim" :disabled="claiming.has(chest.id)" @click="emit('claim', chest)">{{ failed.has(chest.id) ? t("task.cta.retry") : t("task.cta.openChest") }}</button>
          <span v-else class="task__lock" :aria-label="t('task.status.locked')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.tasks { padding:var(--s-4) var(--s-4) var(--s-2); scroll-margin-top:calc(var(--header-h) + var(--s-4)); }
.tasks__head { display:flex; align-items:center; flex-wrap:wrap; gap:var(--s-1) var(--s-3); margin-bottom:var(--s-2); }
.tasks__head h2 { margin:0; font-size:16px; font-weight:700; display:flex; align-items:baseline; gap:var(--s-2); }
.tasks__count { font-size:13px; font-weight:500; color:var(--text-3); font-variant-numeric:tabular-nums; }
.tasks__reset { margin-left:auto; font-size:12px; color:var(--text-3); }
.tasks__list { list-style:none; margin:0 calc(-1 * var(--s-2)); padding:0; display:grid; }
.task { display:grid; grid-template-columns:36px minmax(0,1fr) 88px; gap:var(--s-3); align-items:center; min-height:64px; padding:var(--s-3) var(--s-2); border-radius:var(--r-md); }
.task + .task { border-top:1px solid var(--line); }
.task--claimable { background:var(--accent-tint); border-top-color:transparent; }
.task--claimable + .task { border-top-color:transparent; }
.task__icon { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:var(--r-sm); background:var(--accent-tint); color:var(--accent-text); }
.task--claimable .task__icon { background:var(--surface); }
.task__icon svg { width:18px; height:18px; }
.task__main { min-width:0; display:grid; gap:6px; }
.task__title { font-size:14px; font-weight:600; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.task__title :deep(*) { white-space:nowrap; }
.task__progress { font-size:12px; color:var(--text-2); font-variant-numeric:tabular-nums; }
.task__more { font-size:12px; justify-self:start; }
.task__error { font-size:12px; padding:4px 8px; border-radius:var(--r-sm); }
.task__side { display:grid; justify-items:end; gap:6px; }
.task__reward { display:inline-flex; align-items:center; gap:3px; font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
.task__reward svg { width:14px; height:14px; color:var(--gold); }
.task__side .btn { min-width:64px; position:relative; }
.task__side .btn::before { content:""; position:absolute; inset:-4px -2px; }
.task__claim { background:var(--accent-tint); border-color:color-mix(in srgb, var(--accent) 35%, transparent); color:var(--accent-text); font-weight:600; }
.task__claim:hover { background:var(--accent-soft); }
.task__hold { visibility:hidden; }
.spin { position:absolute; width:14px; height:14px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:spin .8s linear infinite; }
.task__done { display:inline-flex; align-items:center; gap:3px; font-size:12px; color:var(--text-3); white-space:nowrap; }
.task__done svg { width:13px; height:13px; }
.task--claimed .task__title, .task--claimed .task__reward { color:var(--text-3); }
.task__lock { display:flex; width:30px; height:30px; align-items:center; justify-content:center; color:var(--text-3); }
.task__lock svg { width:16px; height:16px; }
@keyframes spin { to { transform:rotate(360deg); } }
:lang(ko) .task__title { word-break:keep-all; }
</style>
