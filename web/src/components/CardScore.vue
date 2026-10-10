<script setup lang="ts">
/**
 * 卡片頁右欄最上面的評分塊（owner 2026-10-11）：平均、1–5 星分布、自己給的星數。
 *
 * 只管畫與收點擊；讀寫在卡片頁（頁首那一行也要用同一份平均）。
 * 星數是一組單選：方向鍵移動、空白鍵選；再點一次自己目前的星數就是收回。
 */
import { computed, ref } from "vue";
import type { CardScore } from "@/lib/api";

const props = defineProps<{
  score: CardScore | null;
  /** 看的人是這張卡的作者：不能評自己的卡，只看分布 */
  own: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ rate: [score: number | null]; write: [] }>();

/** 滑過時先亮到那一顆，讓人看得出點下去是幾星 */
const hover = ref(0);
const shown = computed(() => hover.value || props.score?.mine || 0);
const max = computed(() => Math.max(1, ...(props.score?.histogram ?? [0])));

function pick(n: number) {
  if (props.busy) return;
  emit("rate", props.score?.mine === n ? null : n);
}
function onKey(e: KeyboardEvent, n: number) {
  const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const to = Math.min(5, Math.max(1, n + step));
  const group = (e.currentTarget as HTMLElement).parentElement;
  group?.querySelector<HTMLElement>(`[data-star="${to}"]`)?.focus();
  pick(to);
}
const STAR = "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z";
</script>

<template>
  <section class="score panel" data-tour="card-score" :aria-labelledby="'score-h'">
    <h2 id="score-h" class="score__title">{{ $t("score.title") }}</h2>
    <div class="score__row">
      <div class="score__big">
        <strong class="score__avg">{{ score?.average != null ? score.average.toFixed(1) : "—" }}</strong>
        <span class="score__stars" role="img" :aria-label="$t('score.average', { n: score?.average ?? 0 })">
          <span v-for="i in 5" :key="i" :class="{ 'is-on': (score?.average ?? 0) >= i - 0.5 }">★</span>
        </span>
        <small class="subtle">{{ $t("score.count", { n: score?.count ?? 0 }) }}</small>
      </div>
      <ol class="score__hist" :aria-label="$t('score.histogram')">
        <li v-for="i in [5, 4, 3, 2, 1]" :key="i">
          <span>{{ i }}</span>
          <span class="score__bar"><i :style="{ width: `${((score?.histogram[i - 1] ?? 0) / max) * 100}%` }" /></span>
          <span class="score__n">{{ score?.histogram[i - 1] ?? 0 }}</span>
        </li>
      </ol>
    </div>

    <div v-if="!own" class="score__mine">
      <div class="score__mine-head">
        <span>{{ $t("score.mine") }}</span>
        <button type="button" class="score__write" @click="emit('write')">{{ $t("score.write") }}</button>
      </div>
      <div class="score__input" role="radiogroup" :aria-label="$t('score.rate')" :aria-busy="busy || undefined" @mouseleave="hover = 0">
        <button
          v-for="i in 5"
          :key="i"
          type="button"
          role="radio"
          class="score__star"
          :class="{ 'is-on': i <= shown }"
          :data-star="i"
          :aria-checked="score?.mine === i"
          :aria-label="$t('score.stars', { n: i })"
          :tabindex="(score?.mine ?? 1) === i ? 0 : -1"
          @mouseenter="hover = i"
          @click="pick(i)"
          @keydown="onKey($event, i)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" fill="currentColor" /></svg>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.score { display: grid; gap: var(--s-3); padding: var(--s-4); }
.score__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.score__row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-4); align-items: center; }
.score__big { display: grid; justify-items: center; gap: 2px; }
.score__avg { font-size: 40px; line-height: 1; font-weight: 700; font-variant-numeric: tabular-nums; }
.score__stars { font-size: 13px; letter-spacing: 1px; color: var(--border-strong); }
.score__stars .is-on { color: var(--gold); }
.score__big small { font-size: 12px; }
.score__hist { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 11.5px; color: var(--text-3); }
.score__hist li { display: grid; grid-template-columns: 10px minmax(0, 1fr) 28px; gap: 6px; align-items: center; }
.score__bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.score__bar i { display: block; height: 100%; border-radius: 3px; background: var(--gold); }
.score__n { text-align: right; font-variant-numeric: tabular-nums; }

.score__mine { display: grid; gap: 6px; padding-top: var(--s-3); box-shadow: 0 -1px 0 var(--line); }
.score__mine-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-2); }
.score__write { border: 0; background: none; padding: 4px 0; font: inherit; font-weight: 600; color: var(--accent-text); cursor: pointer; }
.score__input { display: flex; gap: 2px; }
.score__star { width: 36px; height: 36px; padding: 3px; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--border-strong); cursor: pointer; transition: color var(--dur) var(--ease), transform var(--dur) var(--ease); }
.score__star svg { width: 100%; height: 100%; }
.score__star.is-on { color: var(--gold); }
.score__star:hover { transform: scale(1.08); }
.score__star:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.score__input[aria-busy="true"] { opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .score__star { transition: none; } .score__star:hover { transform: none; } }
</style>
