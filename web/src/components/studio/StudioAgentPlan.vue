<script setup lang="ts">
/**
 * Agent 模式排出來的計畫：每一組都能改標題、描述、構圖、張數與參考方式，或整組刪掉；
 * 作者看過再按「全部生成」。實際送出由頁面做（第一組先畫，跟著它的幾組拿它的結果當參考圖）。
 */
import type { PlanShot } from "@/lib/media-generation";

export type ShotStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export interface AgentShot extends PlanShot {
  status?: ShotStatus;
}
defineProps<{
  summary: string;
  credits: number;
  shots: AgentShot[];
  /** 這份計畫全部生成大約要多少點（照目前的模型）。 */
  estimate: number;
  hasReference: boolean;
  state: "editing" | "running" | "done";
}>();
const emit = defineEmits<{ run: []; discard: []; remove: [index: number] }>();
const SHAPES = ["tall", "wide", "square"] as const;
</script>

<template>
  <section class="plan panel" :aria-label="$t('studio.agent.title')">
    <header class="plan__head">
      <h2>{{ $t("studio.agent.title") }}</h2>
      <p v-if="summary" class="plan__summary">{{ summary }}</p>
      <p class="subtle">{{ $t("studio.agent.credits", { n: credits }) }}</p>
    </header>
    <ol class="plan__shots">
      <li v-for="(shot, i) in shots" :key="i" class="shot-card" :class="shot.status && `shot-card--${shot.status}`">
        <div class="shot-card__top">
          <span class="shot-card__n">{{ i + 1 }}</span>
          <input v-model="shot.title" class="input shot-card__title" maxlength="40" :aria-label="$t('studio.agent.shotTitle', { n: i + 1 })" :disabled="state !== 'editing'" />
          <span v-if="shot.skill" class="shot-card__skill">/ {{ $t(`studio.skill.${shot.skill}.name`) }}</span>
          <span v-if="shot.status" class="shot-card__status" role="status">{{ $t(`studio.agent.status.${shot.status}`) }}</span>
          <button v-if="state === 'editing' && shots.length > 1" type="button" class="btn btn--sm btn--ghost" :aria-label="$t('studio.agent.remove', { n: i + 1 })" @click="emit('remove', i)">×</button>
        </div>
        <textarea v-model="shot.prompt" class="input shot-card__prompt" rows="3" maxlength="1500" autocomplete="off" :aria-label="$t('studio.agent.prompt', { n: i + 1 })" :disabled="state !== 'editing'" />
        <div class="shot-card__opts">
          <label>
            <span>{{ $t("studio.agent.shape") }}</span>
            <select v-model="shot.shape" class="input" :disabled="state !== 'editing'">
              <option v-for="s in SHAPES" :key="s" :value="s">{{ $t(`studio.agent.shapes.${s}`) }}</option>
            </select>
          </label>
          <label>
            <span>{{ $t("studio.params.count") }}</span>
            <select v-model.number="shot.count" class="input" :disabled="state !== 'editing'">
              <option v-for="n in 4" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <label>
            <span>{{ $t("studio.agent.reference") }}</span>
            <select v-model="shot.reference" class="input" :disabled="state !== 'editing'">
              <option value="none">{{ $t("studio.agent.refs.none") }}</option>
              <option v-if="i > 0" value="anchor">{{ $t("studio.agent.refs.anchor") }}</option>
              <option v-if="hasReference" value="given">{{ $t("studio.agent.refs.given") }}</option>
            </select>
          </label>
        </div>
      </li>
    </ol>
    <p v-if="state === 'done'" class="notice plan__done" role="status">{{ $t("studio.agent.done") }}</p>
    <div class="plan__actions">
      <button type="button" class="btn" :disabled="state === 'running'" @click="emit('discard')">{{ $t(state === "done" ? "dialog.close" : "studio.agent.discard") }}</button>
      <button v-if="state !== 'done'" type="button" class="btn btn--primary" :disabled="state === 'running' || !shots.some((s) => s.prompt.trim())" @click="emit('run')">
        {{ $t(state === "running" ? "studio.agent.running" : "studio.agent.run", { n: estimate }) }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.plan { display: grid; gap: var(--s-4); padding: var(--s-4); border-radius: var(--r-lg); }
.plan__head { display: grid; gap: var(--s-1); }
.plan__head h2 { margin: 0; font-size: 17px; }
.plan__head p { margin: 0; }
.plan__summary { font-size: 14px; line-height: 1.6; }
.plan__shots { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.shot-card { display: grid; gap: var(--s-2); padding: var(--s-3); border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); }
.shot-card--running { border-color: var(--accent); }
.shot-card--failed, .shot-card--skipped { border-color: var(--danger); }
.shot-card__top { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.shot-card__n { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--surface-2); font-size: 12.5px; font-weight: 600; }
.shot-card__title { flex: 1; min-width: 0; height: var(--h-sm); font-weight: 600; }
.shot-card__skill { flex: none; color: var(--accent-text); font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.shot-card__status { flex: none; font-size: 12.5px; color: var(--text-2); white-space: nowrap; }
.shot-card--done .shot-card__status { color: var(--success); }
.shot-card--failed .shot-card__status, .shot-card--skipped .shot-card__status { color: var(--danger); }
.shot-card__prompt { width: 100%; resize: vertical; font-size: 14px; line-height: 1.6; }
.shot-card__opts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-2); }
.shot-card__opts label { display: grid; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--text-2); min-width: 0; }
.shot-card__opts .input { font-weight: 400; color: var(--text); }
.plan__done { margin: 0; }
.plan__actions { display: flex; justify-content: flex-end; gap: var(--s-2); flex-wrap: wrap; }
@media (max-width: 640px) {
  .shot-card__opts { grid-template-columns: 1fr 1fr; }
  .shot-card__opts label:last-child { grid-column: 1 / -1; }
  .plan__actions .btn { flex: 1 1 auto; }
}
</style>
