<script setup lang="ts">
/**
 * 審核頁作者面板裡的「作者行為」（只給審核員，UI 小稿 ui-author-behavior.md，owner 2026-11-24）：
 * 異常摘要（有異常才出現，不用展開就看得到）＋可收合的近 7 天數字。
 * 異常由伺服器判定（src/review-ai.ts authorActivity），這裡只顯示結果與觸發的數字；門檻只拿來寫進說明句。
 * 只有數字，沒有帳號或裝置識別碼。null＝量不到，不寫 0。
 * 跟審核頁同一道門：403／404／409／410 直接不顯示這一區，不影響頁面其他部分。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, fetchReviewAuthorActivity, type ReviewAuthorActivity } from "@/lib/api";
import { useSession } from "@/lib/session";

const props = defineProps<{ submissionId: string }>();
const { t, locale } = useI18n();
const session = useSession();

/** 與伺服器 ACTIVITY_THRESHOLDS 同值，只用在說明句；判定永遠以伺服器回的 anomalies 為準 */
const THRESHOLDS = { burst: { hours: 12, chars: 1500 }, device: { heavy: 5 } } as const;
const WINDOW_DAYS = 7, DAY_HOURS = 24, RECENT_COUNT = 5;
const KNOWN = new Set(["burst_long", "quota_full", "quick_gap", "device", "device_heavy"]);
const HIDDEN = new Set([403, 404, 409, 410]);

const data = ref<ReviewAuthorActivity | null>(null);
const loading = ref(false);
const error = ref("");
const hidden = ref(false);
const open = ref(false);
let seq = 0;

const isPhone = () => typeof matchMedia === "function" && !matchMedia("(min-width: 760px)").matches;

async function load() {
  const mine = ++seq;
  loading.value = true; error.value = ""; hidden.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const result = await fetchReviewAuthorActivity(props.submissionId, token);
    if (mine !== seq) return;
    if (!result || !Array.isArray(result.anomalies)) { hidden.value = true; return; }
    data.value = result;
    // 有異常預設展開，沒有就收合；手機一律先收合（異常摘要在上面，不會看不到）
    open.value = result.anomalies.some((a) => KNOWN.has(a.code)) && !isPhone();
  } catch (err) {
    if (mine !== seq) return;
    if (err instanceof ApiError && HIDDEN.has(err.status)) { hidden.value = true; return; }
    error.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("reviewV2.activity.loadFailed");
  } finally {
    if (mine === seq) loading.value = false;
  }
}
watch(() => props.submissionId, () => { data.value = null; void load(); }, { immediate: true });

const num = (n: number) => new Intl.NumberFormat(String(locale.value)).format(n);
const unmeasured = () => t("reviewV2.mark.unmeasured");
/** 分鐘換成最順的單位：一小時內寫分鐘、兩天內寫小時，再長寫天 */
function duration(minutes: number): string {
  const unit = (n: number, u: "minute" | "hour" | "day", digits: number) =>
    new Intl.NumberFormat(String(locale.value), { style: "unit", unit: u, unitDisplay: "long", maximumFractionDigits: digits }).format(n);
  if (minutes < 60) return unit(Math.max(0, Math.round(minutes)), "minute", 0);
  if (minutes < 48 * 60) return unit(minutes / 60, "hour", 1);
  return unit(minutes / 1440, "day", 1);
}

const codes = computed(() => new Set((data.value?.anomalies ?? []).map((a) => a.code)));
const anomalies = computed(() => {
  const d = data.value;
  if (!d) return [];
  return d.anomalies.filter((a) => KNOWN.has(a.code)).map((a) => {
    const n = a.value ?? 0;
    switch (a.code) {
      case "burst_long":
        return { code: a.code, label: t("reviewV2.activity.anomaly.burst_long"), note: t("reviewV2.activity.anomalyNote.burst_long", { hours: THRESHOLDS.burst.hours, n: num(n), chars: num(THRESHOLDS.burst.chars) }, n) };
      case "quota_full":
        return { code: a.code, label: t("reviewV2.activity.anomaly.quota_full"), note: t("reviewV2.activity.anomalyNote.quota_full", { used: num(d.weekly.used), limit: num(d.weekly.limit) }) };
      case "quick_gap":
        return { code: a.code, label: t("reviewV2.activity.anomaly.quick_gap"), note: t("reviewV2.activity.anomalyNote.quick_gap", { gap: duration(n) }) };
      default: {
        const heavy = a.code === "device_heavy";
        return {
          code: a.code,
          label: t(heavy ? "reviewV2.activity.anomaly.device_heavy" : "reviewV2.activity.anomaly.device", { n: num(n) }, n),
          note: t("reviewV2.activity.anomalyNote.device", { heavy: THRESHOLDS.device.heavy }),
        };
      }
    }
  });
});
const heavyCount = computed(() => anomalies.value.filter((a) => a.code === "device_heavy").length);

const rows = computed(() => {
  const d = data.value;
  if (!d) return [];
  const recent = d.recent.slice(0, RECENT_COUNT);
  return [
    { key: "weekly", label: t("reviewV2.activity.row.weekly"), value: `${num(d.weekly.used)} / ${num(d.weekly.limit)}`, flag: codes.value.has("quota_full") ? t("reviewV2.activity.flag.quotaFull") : "" },
    { key: "day", label: t("reviewV2.activity.row.day", { hours: DAY_HOURS }), value: t("reviewV2.activity.count", { n: num(d.submissions24h) }, d.submissions24h), flag: "" },
    { key: "week", label: t("reviewV2.activity.row.week", { days: WINDOW_DAYS }), value: t("reviewV2.activity.count", { n: num(d.submissions7d) }, d.submissions7d), flag: "" },
    { key: "avgGap", label: t("reviewV2.activity.row.avgGap"), value: d.avgGapHours === null ? unmeasured() : duration(d.avgGapHours * 60), flag: "" },
    // 「極短」跟著伺服器的判定走：它看的是這張距上一張，不是平均
    { key: "sincePrevious", label: t("reviewV2.activity.row.sincePrevious"), value: d.minutesSincePrevious === null ? unmeasured() : duration(d.minutesSincePrevious), flag: codes.value.has("quick_gap") ? t("reviewV2.activity.flag.quickGap") : "" },
    { key: "recentChars", label: t("reviewV2.activity.row.recentChars", { n: RECENT_COUNT }), value: recent.length ? recent.map((r) => (r.chars === null ? unmeasured() : num(r.chars))).join(" · ") : unmeasured(), flag: "" },
    { key: "deviceAccounts", label: t("reviewV2.activity.row.deviceAccounts"), value: d.deviceAccounts === null ? unmeasured() : t("reviewV2.activity.deviceValue", { n: num(d.deviceAccounts) }, d.deviceAccounts), flag: "" },
  ];
});
/** 能拿來比較的都量不到（第一次送審、裝置未確認）：照一般流程審 */
const insufficient = computed(() => !!data.value && data.value.avgGapHours === null && data.value.minutesSincePrevious === null && data.value.deviceAccounts === null);

function onToggle(e: Event) { open.value = (e.target as HTMLDetailsElement).open; }
</script>

<template>
  <div v-if="!hidden" class="activity" data-author-activity>
    <template v-if="loading && !data">
      <p class="sr-only" role="status">{{ $t("state.loading") }}</p>
      <div class="activity__ghosts" aria-hidden="true"><div class="ghost activity__ghost" /><div class="ghost activity__ghost activity__ghost--short" /></div>
    </template>
    <div v-else-if="error" class="notice notice--error activity__error" role="alert" data-activity-error>
      <span>{{ error }}</span>
      <button type="button" class="btn btn--sm" data-activity-retry @click="load">{{ $t("reviewV2.activity.retry") }}</button>
    </div>
    <template v-else-if="data">
      <div v-if="anomalies.length" class="activity__alert" data-activity-anomalies>
        <p class="activity__summary" role="status">
          <span aria-hidden="true">⚑ </span>{{ heavyCount
            ? $t("reviewV2.activity.summaryHeavy", { n: anomalies.length, heavy: heavyCount }, anomalies.length)
            : $t("reviewV2.activity.summary", { n: anomalies.length }, anomalies.length) }}
        </p>
        <ul class="activity__list" :aria-label="$t('reviewV2.activity.listLabel')">
          <li v-for="a in anomalies" :key="a.code" class="activity__item" :data-anomaly="a.code">
            <span class="chip activity__chip"><span aria-hidden="true">⚑</span>{{ a.label }}</span>
            <span class="activity__note">{{ a.note }}</span>
          </li>
        </ul>
      </div>
      <details class="activity__details" :open="open" data-activity-details @toggle="onToggle">
        <summary class="activity__toggle">{{ $t("reviewV2.activity.title", { days: WINDOW_DAYS }) }}</summary>
        <dl class="activity__rows">
          <div v-for="r in rows" :key="r.key" :data-activity-row="r.key">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}<span v-if="r.flag" class="chip activity__chip activity__flag"><span aria-hidden="true">⚑</span>{{ r.flag }}</span></dd>
          </div>
        </dl>
        <p v-if="insufficient" class="subtle activity__insufficient" data-activity-insufficient>{{ $t("reviewV2.activity.insufficient") }}</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.activity { display: grid; gap: var(--s-2); min-width: 0; }
.activity__ghosts { display: grid; gap: var(--s-2); }
.activity__ghost { height: var(--h-md); }
.activity__ghost--short { width: 60%; }
.activity__error { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; justify-content: space-between; margin: 0; }
.activity__alert { display: grid; gap: var(--s-2); }
.activity__summary { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); font-size: 13px; font-weight: 600; color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); overflow-wrap: anywhere; }
.activity__list { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.activity__item { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-2); align-items: center; min-width: 0; }
.activity__chip, .activity__chip:hover { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); font-weight: 600; max-width: 100%; height: auto; min-height: 26px; cursor: default; }
.activity__note { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; min-width: 0; }
.activity__details { min-width: 0; }
.activity__toggle { min-height: var(--h-md); line-height: var(--h-md); font-size: 13px; font-weight: 600; color: var(--text-2); cursor: pointer; }
.activity__rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--s-2); margin: var(--s-1) 0 0; }
.activity__rows div { display: grid; gap: 2px; min-width: 0; }
/* 手機 390 直排（小稿「寬度與無障礙」） */
@media (max-width: 759px) { .activity__rows { grid-template-columns: minmax(0, 1fr); } }
.activity__rows dt { font-size: 12px; color: var(--text-3); }
.activity__rows dd { margin: 0; font-size: 14px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.activity__flag { margin-inline-start: var(--s-2); vertical-align: middle; }
.activity__insufficient { margin: var(--s-2) 0 0; }
.activity:lang(ko) { word-break: keep-all; }
.activity:lang(ja) { word-break: auto-phrase; }
</style>
