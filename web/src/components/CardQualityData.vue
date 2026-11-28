<script setup lang="ts">
/*
 * 卡片數據的同一組區塊：預覽抽屜與卡片頁照同一個順序列（ui.md「同一組數據」）。
 * 玩家數據 → 篇幅 → 呈現方式；沒有內容的區塊整塊不出現，不寫「無」。
 * 數字都是伺服器取整後的計數，這裡只換成各語言的寫法（lib/card-quality-format）。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { CardQualityDetail } from "../../../shared/card-quality";
import { qualityCharacters, qualityPercent } from "@/lib/card-quality-format";
import WorkshopIcon from "./workshop/WorkshopIcon.vue";

const props = defineProps<{ detail: CardQualityDetail | null; loading?: boolean; failed?: boolean }>();
const emit = defineEmits<{ retry: [] }>();
const { t, locale } = useI18n();

const number = (n: number, digits = 0) => new Intl.NumberFormat(String(locale.value), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

const deep = computed(() => props.detail?.deepPlay ?? null);
/* 續玩率旁的說明（問號鈕）：怎麼算、誰算合格玩家；不寫玩家人數（owner 2026-11-28）。預設收起，換一張卡就收回去 */
const helpId = `cq-help-${Math.random().toString(36).slice(2, 9)}`;
const helpOpen = ref(false);
watch(() => props.detail, () => { helpOpen.value = false; });
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
            <span class="cq__deep-label">{{ $t("quality.retention.label") }}</span>
            <span class="cq__deep-num">{{ qualityPercent(deep.reached, deep.players) }}</span>
            <button type="button" class="cq__help" :aria-label="$t('quality.retention.help')" :aria-expanded="helpOpen" :aria-controls="helpId" @click="helpOpen = !helpOpen">
              <WorkshopIcon name="info" />
            </button>
          </div>
          <div v-show="helpOpen" :id="helpId" class="cq__help-body">
            <p>{{ $t("quality.retention.explain", { n: deep.turns }) }}</p>
            <p class="cq__help-rules">{{ $t("quality.retention.rules") }}</p>
          </div>
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
.cq__deep-top { display: flex; align-items: center; gap: var(--s-2); }
.cq__deep-num { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.cq__deep-label { font-size: 13px; font-weight: 600; color: var(--text-2); }
/* 問號鈕：圖示 16、點擊區 30（--h-sm），不搶數字 */
.cq__help {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: var(--h-sm); height: var(--h-sm); margin: -4px 0 -4px -4px; padding: 0; border: 0; border-radius: var(--r-pill);
  background: none; color: var(--text-3); cursor: pointer;
}
.cq__help:hover, .cq__help[aria-expanded="true"] { color: var(--accent-text); }
.cq__help svg { width: 16px; height: 16px; }
.cq__help-body { display: grid; gap: 4px; margin-top: var(--s-1); font-size: 13px; line-height: 1.6; color: var(--text-2); }
.cq__help-body p { margin: 0; }
.cq__help-rules { font-size: 12px; color: var(--text-3); }
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
.cq__note:lang(ko), .cq__help-body:lang(ko) { word-break: keep-all; }
.cq__note:lang(ja), .cq__help-body:lang(ja) { word-break: auto-phrase; }

.cq__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }

.cq__failed { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin: 0; font-size: 13px; color: var(--text-2); }
.cq__ghosts { display: grid; gap: var(--s-3); }
.cq__ghost { height: 44px; border-radius: var(--r-md); }
.cq__ghost--tall { height: 72px; }
.cq__ghost--short { width: 60%; }
</style>
