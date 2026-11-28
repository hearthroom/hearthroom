<script setup lang="ts">
/*
 * 卡片數據的同一組區塊：預覽抽屜與卡片頁照同一個順序列（ui.md「同一組數據」）。
 * 玩家數據 → 篇幅 → 呈現方式；沒有內容的區塊整塊不出現，不寫「無」。
 * 數字都是伺服器取整後的計數，這裡只換成各語言的寫法（lib/card-quality-format）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CardQualityDetail } from "../../../shared/card-quality";
import { qualityCharacters, qualityPercent, qualityRatio } from "@/lib/card-quality-format";

const props = defineProps<{ detail: CardQualityDetail | null; loading?: boolean; failed?: boolean }>();
const emit = defineEmits<{ retry: [] }>();
const { t, locale } = useI18n();

const number = (n: number, digits = 0) => new Intl.NumberFormat(String(locale.value), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

const deep = computed(() => props.detail?.deepPlay ?? null);
const stats = computed(() => {
  const d = props.detail;
  if (!d) return [];
  const out: { key: string; value: string; label: string }[] = [];
  if (d.rating) out.push({ key: "rating", value: number(d.rating.average, 1), label: t("quality.rating") });
  if (d.comments) out.push({ key: "comments", value: number(d.comments), label: t("quality.comments") });
  // 中位數可能落在兩個回合之間（6.5）：留一位小數，整數照寫（14，不寫 14.0）
  if (d.deepPlay) out.push({ key: "median", value: t("quality.turns", { n: new Intl.NumberFormat(String(locale.value), { maximumFractionDigits: 1 }).format(d.deepPlay.medianTurns) }, d.deepPlay.medianTurns), label: t("quality.median") });
  return out;
});
const length = computed(() => props.detail?.length ?? null);
const lengthRows = computed(() => {
  const l = length.value;
  if (!l) return [];
  const sep = t("quality.sep");
  const rows: { key: string; label: string; value: string }[] = [];
  if (l.setting !== null) rows.push({ key: "setting", label: t("quality.row.setting"), value: qualityCharacters(l.setting) });
  if (l.worldbook.entries > 0) rows.push({ key: "worldbook", label: t("quality.row.worldbook"), value: t("quality.entries", { n: number(l.worldbook.entries) }, l.worldbook.entries) + sep + qualityCharacters(l.worldbook.characters) });
  if (l.openings.count > 0) rows.push({ key: "openings", label: t("quality.row.openings"), value: t("quality.openingsCount", { n: number(l.openings.count) }, l.openings.count) + sep + qualityCharacters(l.openings.characters) });
  return rows;
});
const presentation = computed(() => {
  const p = length.value?.presentation;
  if (!p) return [];
  const out: string[] = [];
  if (p.openingPage) out.push(t("quality.pres.openingPage"));
  if (p.displayRules > 0) out.push(t("quality.pres.rules", { n: number(p.displayRules) }, p.displayRules));
  if (p.panel) out.push(t("quality.pres.panel"));
  return out;
});
const hasPlayers = computed(() => Boolean(deep.value) || stats.value.length > 0);
</script>

<template>
  <div class="cq">
    <div v-if="loading" class="cq__ghosts" aria-hidden="true">
      <div class="ghost cq__ghost cq__ghost--tall" />
      <div class="ghost cq__ghost" />
      <div class="ghost cq__ghost cq__ghost--short" />
    </div>
    <p v-else-if="failed" class="cq__failed" role="status">
      <span>{{ $t("quality.loadFailed") }}</span>
      <button type="button" class="btn btn--sm" @click="emit('retry')">{{ $t("quality.retry") }}</button>
    </p>
    <template v-else-if="detail">
      <section v-if="hasPlayers" class="cq__sec">
        <h3 class="cq__h">{{ $t("quality.section.players") }}</h3>
        <div v-if="deep" class="cq__deep">
          <div class="cq__deep-top">
            <span class="cq__deep-num">{{ qualityRatio(deep.reached, deep.players) }}</span>
            <span class="cq__deep-pct">{{ qualityPercent(deep.reached, deep.players) }}</span>
            <span class="cq__deep-label">{{ $t("quality.deep.label", { n: deep.turns }) }}</span>
          </div>
          <p class="cq__deep-sent">{{ $t("quality.deep.sentence", { players: number(deep.players), reached: number(deep.reached), n: deep.turns }) }}</p>
        </div>
        <dl v-if="stats.length" class="cq__stats" :style="{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }">
          <div v-for="s in stats" :key="s.key" class="cq__stat">
            <dt>{{ s.label }}</dt>
            <dd>{{ s.value }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="length" class="cq__sec">
        <h3 class="cq__h">{{ $t("quality.section.length") }}</h3>
        <p class="cq__total">{{ qualityCharacters(length.total) }}</p>
        <dl v-if="lengthRows.length" class="cq__rows">
          <div v-for="r in lengthRows" :key="r.key" class="cq__row">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          </div>
        </dl>
        <p class="cq__note">{{ $t("quality.lengthNote") }}</p>
      </section>

      <section v-if="presentation.length" class="cq__sec">
        <h3 class="cq__h">{{ $t("quality.section.presentation") }}</h3>
        <ul class="cq__chips">
          <li v-for="p in presentation" :key="p" class="chip">{{ p }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cq { display: grid; gap: var(--s-5); }
.cq__h { margin: 0 0 var(--s-2); font-size: 13px; font-weight: 600; color: var(--text-2); }
.cq__sec { min-width: 0; }

.cq__deep { display: grid; gap: 2px; padding: var(--s-3) 14px; border-radius: var(--r-md); background: var(--surface-2); }
.cq__deep-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.cq__deep-num { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.cq__deep-pct { font-size: 15px; font-weight: 600; color: var(--text-2); font-variant-numeric: tabular-nums; }
.cq__deep-label { font-size: 13px; font-weight: 600; color: var(--text-2); }
.cq__deep-sent { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-2); }
.cq__deep + .cq__stats { margin-top: var(--s-2); }

.cq__stats { display: grid; gap: var(--s-2); margin: 0; }
.cq__stat { display: grid; align-content: start; min-width: 0; padding: var(--s-2) 10px; border-radius: var(--r-sm); box-shadow: inset 0 0 0 1px var(--line); }
.cq__stat dd { order: -1; margin: 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cq__stat dt { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.cq__total { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.cq__rows { display: grid; margin: var(--s-2) 0 0; }
.cq__row { display: flex; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) 0; box-shadow: 0 -1px 0 var(--line); font-size: 13px; }
.cq__row dt { min-width: 0; color: var(--text-2); }
.cq__row dd { flex: none; margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.cq__note { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.cq__note:lang(ko), .cq__deep-sent:lang(ko) { word-break: keep-all; }
.cq__note:lang(ja), .cq__deep-sent:lang(ja) { word-break: auto-phrase; }

.cq__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }

.cq__failed { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin: 0; font-size: 13px; color: var(--text-2); }
.cq__ghosts { display: grid; gap: var(--s-3); }
.cq__ghost { height: 44px; border-radius: var(--r-md); }
.cq__ghost--tall { height: 72px; }
.cq__ghost--short { width: 60%; }
</style>
