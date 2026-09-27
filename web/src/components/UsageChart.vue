<script setup lang="ts">
/**
 * 積分消耗長條圖：只有一個量（消耗），所以一個顏色、沒有圖例，標題就是它的名字。
 * 每一根都能滑過或用鍵盤停上去看當天（當週）的數字；精確的逐筆資料在下面的流水裡。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { monthDay, whole } from "@/lib/format";
import { niceMax, type UsageBar } from "@/lib/score-usage";

const props = defineProps<{ bars: UsageBar[]; weekly?: boolean }>();
const { t } = useI18n();

const max = computed(() => niceMax(Math.max(0, ...props.bars.map((b) => b.spent))));
const empty = computed(() => props.bars.every((b) => b.spent === 0));
/** 軸標只標幾根，避免三十個日期擠成一團：頭、尾，中間平均取。 */
const labelEvery = computed(() => (props.bars.length <= 8 ? 1 : props.bars.length <= 14 ? 2 : Math.ceil(props.bars.length / 5)));
const period = (b: UsageBar) => (b.start === b.end ? monthDay(b.start) : `${monthDay(b.start)} – ${monthDay(b.end)}`);
const tip = (b: UsageBar) => t("wallet.usage.tip", { period: period(b), spent: whole(b.spent), count: whole(b.count) });
</script>

<template>
  <p v-if="empty" class="usage-chart__empty muted">{{ $t("wallet.usage.empty") }}</p>
  <div v-else class="usage-chart" :style="{ '--n': bars.length }">
    <div class="usage-chart__axis" aria-hidden="true">
      <span>{{ whole(max) }}</span>
      <span>{{ whole(max / 2) }}</span>
      <span>0</span>
    </div>
    <ol class="usage-chart__plot" :aria-label="$t('wallet.usage.title')">
      <li v-for="(b, i) in bars" :key="b.key" class="usage-chart__col" tabindex="0" :aria-label="tip(b)">
        <span class="usage-chart__bar" :style="{ height: `${(b.spent / max) * 100}%` }" />
        <span class="usage-chart__tip" role="tooltip">{{ tip(b) }}</span>
        <span v-if="i % labelEvery === 0 || i === bars.length - 1" class="usage-chart__x" :class="{ 'usage-chart__x--end': i === bars.length - 1 }" aria-hidden="true">
          {{ i === bars.length - 1 ? (weekly ? $t("wallet.usage.thisWeek") : $t("time.today")) : monthDay(b.start) }}
        </span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.usage-chart { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-2); height: 200px; padding-bottom: 22px; }
.usage-chart__axis { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; transform: translateY(-0.5em); margin-bottom: -1em; }
/* 格線退到背景：上緣、一半、底線三條 */
.usage-chart__plot {
  position: relative; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px; align-items: end;
  margin: 0; padding: 0; list-style: none;
  background: linear-gradient(var(--line), var(--line)) top / 100% 1px no-repeat,
              linear-gradient(var(--line), var(--line)) center / 100% 1px no-repeat;
  box-shadow: 0 1px 0 var(--line-strong);
}
.usage-chart__col { position: relative; height: 100%; display: flex; align-items: flex-end; justify-content: center; border-radius: 4px 4px 0 0; outline: none; cursor: default; }
.usage-chart__col:hover, .usage-chart__col:focus-visible { background: var(--surface-2); }
.usage-chart__col:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.usage-chart__bar { width: min(100%, 28px); min-height: 0; border-radius: 4px 4px 0 0; background: var(--accent); transition: filter var(--dur) var(--ease); }
.usage-chart__col:hover .usage-chart__bar, .usage-chart__col:focus-visible .usage-chart__bar { filter: brightness(1.1); }
.usage-chart__tip {
  position: absolute; bottom: calc(100% + 6px); left: 50%; z-index: 2; transform: translateX(-50%);
  padding: 6px 10px; border-radius: var(--r-sm); background: var(--text); color: var(--bg);
  font-size: 12px; line-height: 1.4; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: opacity var(--dur) var(--ease);
}
.usage-chart__col:first-child .usage-chart__tip { left: 0; transform: none; }
.usage-chart__col:last-child .usage-chart__tip { left: auto; right: 0; transform: none; }
.usage-chart__col:hover .usage-chart__tip, .usage-chart__col:focus-visible .usage-chart__tip { opacity: 1; }
.usage-chart__x { position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--text-3); white-space: nowrap; }
.usage-chart__x--end { left: auto; right: 0; transform: none; color: var(--text-2); }
.usage-chart__empty { margin: 0; padding: var(--s-6) 0; text-align: center; font-size: 13.5px; }
</style>
