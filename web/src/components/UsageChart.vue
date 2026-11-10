<script setup lang="ts">
/**
 * 積分帳單長條圖：收入在零線上、支出在零線下，共用同一把尺，所以兩邊的高度能直接比。
 * 收入的顏色跟下面流水的「+」一樣，支出是中性灰；上下分開本身就分得出兩者，不只靠顏色。
 * 每一根都能滑過或用鍵盤停上去看當天（當週）的數字；精確的逐筆資料在下面的流水裡。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { monthDay, whole } from "@/lib/format";
import { niceMax, type UsageBar } from "@/lib/score-usage";

const props = defineProps<{ bars: UsageBar[]; weekly?: boolean }>();
const { t } = useI18n();

const top = (pick: (b: UsageBar) => number) => { const v = Math.max(0, ...props.bars.map(pick)); return v > 0 ? niceMax(v) : 0; };
const up = computed(() => top((b) => b.earned));
const down = computed(() => top((b) => b.spent));
const empty = computed(() => up.value === 0 && down.value === 0);
/** 一邊佔不到五分之一高時，它的刻度會跟零疊在一起，就只留零。 */
const share = (v: number) => v / (up.value + down.value);
const pct = (v: number, of: number) => `${of ? (v / of) * 100 : 0}%`;
/** 日期從今天往回每隔幾根標一次，最後一根永遠是「今天」；窄螢幕只留 major 的那些。 */
const step = computed(() => (props.bars.length <= 14 ? 1 : 3));
const major = computed(() => (props.bars.length <= 8 ? 1 : props.bars.length <= 14 ? 2 : 6));
const fromEnd = (i: number) => props.bars.length - 1 - i;
const period = (b: UsageBar) => (b.start === b.end ? monthDay(b.start) : `${monthDay(b.start)} – ${monthDay(b.end)}`);
const tip = (b: UsageBar) => t("wallet.usage.tip", { period: period(b), earned: whole(b.earned), spent: whole(b.spent) });
</script>

<template>
  <p v-if="empty" class="usage-chart__empty muted">{{ $t("wallet.usage.empty") }}</p>
  <div v-else class="usage-chart">
    <ul class="usage-chart__legend">
      <li><i class="usage-chart__key usage-chart__key--earned" />{{ $t("wallet.records.income") }}</li>
      <li><i class="usage-chart__key usage-chart__key--spent" />{{ $t("wallet.records.expense") }}</li>
    </ul>
    <div class="usage-chart__body" :style="{ '--n': bars.length, '--zero': `${share(up) * 100}%` }">
      <div class="usage-chart__axis" aria-hidden="true">
        <div class="usage-chart__half" :style="{ flexGrow: up }">
          <span v-if="share(up) >= 0.2" class="usage-chart__tick">{{ whole(up) }}</span>
          <span class="usage-chart__tick usage-chart__tick--zero">0</span>
        </div>
        <div class="usage-chart__half usage-chart__half--down" :style="{ flexGrow: down }">
          <span v-if="share(down) >= 0.2" class="usage-chart__tick">{{ whole(down) }}</span>
        </div>
      </div>
      <ol class="usage-chart__plot" :aria-label="$t('wallet.usage.title')">
        <li v-for="(b, i) in bars" :key="b.key" class="usage-chart__col" tabindex="0" :aria-label="tip(b)">
          <span class="usage-chart__half" :style="{ flexGrow: up }"><span class="usage-chart__bar usage-chart__bar--earned" :style="{ height: pct(b.earned, up) }" /></span>
          <span class="usage-chart__half usage-chart__half--down" :style="{ flexGrow: down }"><span class="usage-chart__bar usage-chart__bar--spent" :style="{ height: pct(b.spent, down) }" /></span>
          <span class="usage-chart__tip" role="tooltip">{{ tip(b) }}</span>
          <span v-if="fromEnd(i) % step === 0" class="usage-chart__x" :class="{ 'usage-chart__x--end': fromEnd(i) === 0, 'usage-chart__x--minor': fromEnd(i) % major !== 0 }" aria-hidden="true">
            {{ fromEnd(i) === 0 ? (weekly ? $t("wallet.usage.thisWeek") : $t("time.today")) : monthDay(b.start) }}
          </span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.usage-chart { container-type: inline-size; }
.usage-chart__legend { display: flex; gap: var(--s-4); margin: 0 0 var(--s-3); padding: 0; list-style: none; font-size: 12px; color: var(--text-2); }
.usage-chart__legend li { display: flex; align-items: center; gap: 6px; }
.usage-chart__key { width: 10px; height: 10px; border-radius: 3px; }
.usage-chart__body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-2); height: 200px; padding-bottom: 22px; }
.usage-chart__axis { display: flex; flex-direction: column; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; text-align: end; }
.usage-chart__half { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
/* 兩半都貼著零線排：某一半很矮時，刻度往外溢，零還是對準零線 */
.usage-chart__axis .usage-chart__half { justify-content: flex-end; }
.usage-chart__tick { line-height: 1; margin-bottom: auto; transform: translateY(-50%); }
.usage-chart__tick--zero { margin-bottom: 0; transform: translateY(50%); }
.usage-chart__half--down .usage-chart__tick { margin-bottom: 0; transform: translateY(50%); }
/* 格線退到背景：上緣、零線、下緣，零線最重 */
.usage-chart__plot {
  position: relative; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px;
  margin: 0; padding: 0; list-style: none;
  background: linear-gradient(var(--line-strong), var(--line-strong)) 0 var(--zero) / 100% 1px no-repeat,
              linear-gradient(var(--line), var(--line)) top / 100% 1px no-repeat,
              linear-gradient(var(--line), var(--line)) bottom / 100% 1px no-repeat;
}
.usage-chart__col { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; border-radius: 4px; outline: none; cursor: default; }
.usage-chart__col .usage-chart__half { width: 100%; align-items: center; justify-content: flex-end; }
.usage-chart__col .usage-chart__half--down { justify-content: flex-start; }
.usage-chart__col:hover, .usage-chart__col:focus-visible { background: var(--surface-2); }
.usage-chart__col:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.usage-chart__bar { width: min(100%, 28px); flex: none; transition: filter var(--dur) var(--ease); }
.usage-chart__bar--earned, .usage-chart__key--earned { background: var(--success); }
.usage-chart__bar--spent, .usage-chart__key--spent { background: var(--text-3); }
.usage-chart__bar--earned { border-radius: 4px 4px 0 0; margin-bottom: 1px; }
.usage-chart__bar--spent { border-radius: 0 0 4px 4px; margin-top: 1px; }
.usage-chart__col:hover .usage-chart__bar, .usage-chart__col:focus-visible .usage-chart__bar { filter: brightness(1.1); }
.usage-chart__tip {
  position: absolute; bottom: calc(100% + 6px); left: 50%; z-index: 2; transform: translateX(-50%);
  padding: 6px 10px; border-radius: var(--r-sm); background: var(--text); color: var(--hr-page-bg);
  font-size: 12px; line-height: 1.4; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: opacity var(--dur) var(--ease);
}
.usage-chart__col:first-child .usage-chart__tip { left: 0; transform: none; }
.usage-chart__col:last-child .usage-chart__tip { left: auto; right: 0; transform: none; }
.usage-chart__col:hover .usage-chart__tip, .usage-chart__col:focus-visible .usage-chart__tip { opacity: 1; }
.usage-chart__x { position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--text-3); white-space: nowrap; }
.usage-chart__x--end { left: auto; right: 0; transform: none; color: var(--text-2); }
@container (max-width: 520px) { .usage-chart__x--minor { display: none; } }
.usage-chart__empty { margin: 0; padding: var(--s-6) 0; text-align: center; font-size: 13.5px; }
</style>
