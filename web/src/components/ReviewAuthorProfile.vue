<script setup lang="ts">
/**
 * 審核頁的作者側寫（審卡 V2，ui.md §3）：自動標記（新人／穩定／優質／資料不足）、獨立的疑似量產旗標、
 * 依據（樣本不足寫「量不到」不寫 0）、人工改標記。只給審核員看；不自動通過、駁回或不受理。
 * 管理員從這裡開同作者／同裝置的批次不受理。標記之下放作者行為（ReviewAuthorActivity）。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { markReviewAuthor, revokeReviewAuthorMark, type ReviewAuthorProfile } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import ReviewBatchSheet from "@/components/ReviewBatchSheet.vue";
import ReviewAuthorActivity from "@/components/ReviewAuthorActivity.vue";

const props = defineProps<{ submissionId: string; profile: ReviewAuthorProfile; manager: boolean; canMark: boolean }>();
const emit = defineEmits<{ changed: [profile: ReviewAuthorProfile]; batched: [] }>();
const { t, locale } = useI18n();
const session = useSession();

const BATCH_DAYS = 30, TIER_DAYS = 90;
const profile = computed(() => props.profile);
const tierKey = computed(() => (profile.value.tier === "general" ? null : profile.value.tier));
const fmt = computed(() => new Intl.NumberFormat(String(locale.value)));
const measured = (v: number | null | undefined, render: (n: number) => string) => (v === null || v === undefined ? t("reviewV2.mark.unmeasured") : render(v));
const basis = computed(() => {
  const b = profile.value.basis;
  return [
    { key: "decided", value: measured(b.decidedWorks, (n) => fmt.value.format(n)) },
    { key: "firstPass", value: measured(b.firstPassRate, (n) => new Intl.NumberFormat(String(locale.value), { style: "percent" }).format(n)) },
    { key: "memberSince", value: measured(b.memberSince, (n) => dateTime(n)) },
    { key: "deviceAccounts", value: measured(b.deviceAccounts, (n) => fmt.value.format(n)) },
    { key: "recentPending", value: measured(b.deviceRecentWorks, (n) => fmt.value.format(n)) },
    { key: "drops", value: measured(b.dropCases90d, (n) => fmt.value.format(n)) },
    ...(b.suggestions90d ? [{ key: "suggestions", value: fmt.value.format(b.suggestions90d) }] : []),
    // 審核標記：沒有就不列；有就寫「疑似 AI 原文 2、疑似搬運 1」
    ...(b.marks90d && Object.keys(b.marks90d).length ? [{ key: "marks", value: Object.entries(b.marks90d).map(([m, n]) => `${t(`reviewV2.marks.${m}`)} ${fmt.value.format(n)}`).join("、") }] : []),
  ];
});

const sheet = ref(false);
const kind = ref<"tier" | "batch">("tier");
const value = ref("");
const reason = ref("");
const note = ref("");
const busy = ref(false);
const error = ref("");
const batch = ref<"author" | "device" | null>(null);

function openSheet() { sheet.value = true; kind.value = "tier"; value.value = profile.value.tier === "general" ? "none" : profile.value.tier; reason.value = ""; note.value = ""; error.value = ""; }
async function save(clear = false) {
  if (busy.value) return;
  // 取消標記＝撤銷人工覆寫、恢復自動標記，不必選原因
  if (!clear && (!value.value || !reason.value || (reason.value === "other" && !note.value.trim()))) { error.value = t("reviewV2.decide.pickReason"); return; }
  busy.value = true; error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = clear ? await revokeReviewAuthorMark(props.submissionId, token, kind.value)
      : await markReviewAuthor(props.submissionId, token, { kind: kind.value, value: value.value, reasonCode: reason.value, note: note.value.trim() });
    if (res.profile) emit("changed", res.profile);
    sheet.value = false;
  } catch (err) {
    error.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("reviewV2.toast.failed");
  } finally { busy.value = false; }
}
function batchClosed(changed: boolean) { batch.value = null; if (changed) emit("batched"); }
</script>

<template>
  <section class="profile" data-author-profile>
    <div class="profile__head">
      <p class="profile__title">{{ $t("reviewV2.mark.title") }}</p>
      <span v-if="tierKey" class="chip chip--mark" data-profile-tier>{{ $t(`reviewV2.mark.tier.${tierKey}`) }}</span>
      <span v-if="profile.batchSuspected" class="chip chip--batch" data-profile-batch>{{ $t("reviewV2.mark.batch") }}<template v-if="profile.basis.deviceAccounts"> · {{ $t("reviewV2.mark.deviceAccounts", { n: profile.basis.deviceAccounts }, profile.basis.deviceAccounts) }}</template></span>
      <span class="chip chip--quiet">{{ profile.manual.tier || profile.manual.batch ? $t("reviewV2.mark.manual", { date: dateTime((profile.manual.tier ?? profile.manual.batch)!.expiresAt) }) : $t("reviewV2.mark.auto") }}</span>
      <button v-if="canMark" type="button" class="btn btn--sm btn--ghost profile__edit" data-mark-edit @click="openSheet">{{ $t("reviewV2.mark.edit") }}</button>
    </div>
    <p v-if="profile.batchSuspected" class="profile__use">{{ $t("reviewV2.mark.use.batch") }}</p>
    <p v-else-if="tierKey" class="profile__use">{{ $t(`reviewV2.mark.use.${tierKey}`) }}</p>
    <p v-if="profile.tier === 'top' && !profile.batchSuspected" class="profile__use" data-fast-note>{{ $t("reviewV2.fast.note") }}</p>
    <!-- 作者行為（UI 小稿 ui-author-behavior.md）：標記之下先是異常摘要，再是可收合的近 7 天數字；自己讀，失敗或沒權限不擋這個面板 -->
    <ReviewAuthorActivity :submission-id="submissionId" />
    <dl class="profile__basis">
      <div v-for="b in basis" :key="b.key"><dt>{{ $t(`reviewV2.mark.basis.${b.key}`) }}</dt><dd>{{ b.value }}</dd></div>
    </dl>
    <div v-if="manager && ((profile.pendingSameAuthor ?? 0) > 0 || (profile.pendingSameDevice ?? 0) > 0)" class="profile__batch">
      <button v-if="(profile.pendingSameAuthor ?? 0) > 0" type="button" class="btn btn--sm" data-batch-author @click="batch = 'author'">{{ $t("reviewV2.batch.sameAuthor", { n: profile.pendingSameAuthor! + 1 }) }}</button>
      <button v-if="(profile.pendingSameDevice ?? 0) > 0" type="button" class="btn btn--sm" data-batch-device @click="batch = 'device'">{{ $t("reviewV2.batch.sameDevice", { n: profile.pendingSameDevice! + 1 }) }}</button>
    </div>
    <p class="subtle profile__disclaimer">{{ $t("reviewV2.mark.disclaimer") }}</p>

    <div v-if="sheet" class="mark" data-mark-sheet>
      <p class="profile__title">{{ $t("reviewV2.mark.sheetTitle") }}</p>
      <div class="seg" role="group" :aria-label="$t('reviewV2.mark.sheetTitle')">
        <button type="button" class="seg__item" :class="{ 'seg__item--on': kind === 'tier' }" :aria-pressed="kind === 'tier'" @click="kind = 'tier'; value = profile.tier === 'general' ? 'none' : profile.tier">{{ $t("reviewV2.mark.kindTier") }}</button>
        <button type="button" class="seg__item" :class="{ 'seg__item--on': kind === 'batch' }" :aria-pressed="kind === 'batch'" @click="kind = 'batch'; value = profile.batchSuspected ? 'suspected' : 'clear'">{{ $t("reviewV2.mark.kindBatch") }}</button>
      </div>
      <div class="mark__options" role="radiogroup">
        <template v-if="kind === 'tier'">
          <label v-for="v in ['new', 'stable', 'top']" :key="v" class="mark__option"><input v-model="value" type="radio" name="mark-value" :value="v" /><span>{{ $t(`reviewV2.mark.tier.${v}`) }}</span></label>
        </template>
        <template v-else>
          <label class="mark__option"><input v-model="value" type="radio" name="mark-value" value="suspected" /><span>{{ $t("reviewV2.mark.batchOn") }}</span></label>
          <label class="mark__option"><input v-model="value" type="radio" name="mark-value" value="clear" /><span>{{ $t("reviewV2.mark.batchOff") }}</span></label>
        </template>
      </div>
      <label class="field mark__field"><span>{{ $t("reviewV2.mark.reasonLabel") }}</span>
        <select v-model="reason" class="input" required>
          <option value="" disabled>—</option>
          <option v-for="r in ['shared_device', 'missing_data', 'content_checked', 'other']" :key="r" :value="r">{{ $t(`reviewV2.mark.reason.${r}`) }}</option>
        </select>
      </label>
      <label class="field mark__field"><span>{{ $t("reviewV2.mark.noteLabel") }}</span><input v-model="note" class="input" maxlength="500" :required="reason === 'other'" /></label>
      <p class="subtle">{{ $t("reviewV2.mark.ttl", { a: BATCH_DAYS, b: TIER_DAYS }) }}</p>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div class="mark__acts">
        <button type="button" class="btn btn--ghost" :disabled="busy" @click="sheet = false">{{ $t("reviewV2.mark.back") }}</button>
        <button v-if="kind === 'tier' ? profile.manual.tier : profile.manual.batch" type="button" class="btn" :disabled="busy" data-mark-clear @click="save(true)">{{ $t("reviewV2.mark.clear") }}</button>
        <button type="button" class="btn btn--primary" :disabled="busy" data-mark-save @click="save()">{{ $t("reviewV2.mark.save") }}</button>
      </div>
    </div>
    <ReviewBatchSheet v-if="batch" :anchor-id="submissionId" :scope="batch" @close="batchClosed" />
  </section>
</template>

<style scoped>
.profile { display: grid; gap: var(--s-2); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md); margin-block: var(--s-2); }
.profile__head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.profile__title { font-weight: 600; font-size: 14px; margin: 0; }
.profile__edit { margin-inline-start: auto; }
.profile__use { margin: 0; font-size: 13px; color: var(--text-2); }
.profile__basis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--s-2); margin: 0; }
.profile__basis div { display: grid; gap: 2px; }
.profile__basis dt { font-size: 12px; color: var(--text-3); }
.profile__basis dd { margin: 0; font-size: 14px; font-variant-numeric: tabular-nums; }
.profile__batch { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.profile__disclaimer { margin: 0; }
.chip--mark { background: var(--accent-tint); color: var(--accent-text); }
.chip--batch { color: var(--warning-text); }
.chip--quiet { color: var(--text-3); }
.mark { display: grid; gap: var(--s-2); padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.mark__options { display: flex; flex-wrap: wrap; gap: var(--s-3); }
.mark__option { display: inline-flex; gap: var(--s-1); align-items: center; min-height: var(--h-md); cursor: pointer; }
.mark__field { display: grid; gap: var(--s-1); font-size: 13px; margin: 0; }
.mark .seg__item { min-height: var(--h-md); }
.mark__acts { display: flex; flex-wrap: wrap; gap: var(--s-2); justify-content: flex-end; }
.profile:lang(ko) { word-break: keep-all; }
</style>
