<script setup lang="ts">
/**
 * 駁回理由選擇器（審卡 V2，ui.md §2.3）：四組（開場白、設定、分級、其他），可多選、至少一項。
 * 勾選時下方即時預覽「作者會看到」：每項的怎麼改與範例（輔導時是完整改法與改前改後），
 * 有「給選項的三種做法」的代碼（沒有接話點）兩種版本都在最後附上那一塊，
 * 有開場白理由時多一行「並附上好開場的三個要素」。審核員不必再手打改法。
 *
 * locked：一定要帶的理由（有效字數未達標時的「有效字數不足」），勾著、不能取消。
 * 有原作的卡在設定組旁提示「設定可以簡略，開場白照一般標準」——只是提示，不擋任何選項。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { REVIEW_REASON_GROUPS, REVIEW_REASONS, hasOpeningReason, hasOptions, reasonKey, reasonOptionKey, type ReviewReasonGroup } from "@/lib/review-reasons";
import ReviewReasonOptions from "@/components/ReviewReasonOptions.vue";

const props = defineProps<{
  modelValue: string[]; locked: string[]; disabled?: boolean;
  coaching: boolean; coachingDefault: boolean; fandom: boolean; opening: string;
  length: { total?: string; remaining?: string; required?: string };
}>();
const emit = defineEmits<{ "update:modelValue": [value: string[]]; "update:coaching": [value: boolean] }>();
const { t, te } = useI18n();

const groups = Object.keys(REVIEW_REASON_GROUPS) as ReviewReasonGroup[];
const checked = (code: string) => props.locked.includes(code) || props.modelValue.includes(code);
const picked = computed(() => REVIEW_REASONS.filter((c) => checked(c)));
function toggle(code: string, on: boolean) {
  if (props.locked.includes(code)) return;
  const next = new Set(props.modelValue);
  if (on) next.add(code); else next.delete(code);
  emit("update:modelValue", REVIEW_REASONS.filter((c) => next.has(c)));
}
// 字數參數：伺服器給的是 remaining，字串用的是 {gap}（跟作者端同一個鍵）
const params = computed(() => ({ ...props.length, gap: props.length.remaining ?? "" }));
const field = (code: string, name: Parameters<typeof reasonKey>[1]) => (te(reasonKey(code, name)) ? t(reasonKey(code, name), params.value) : "");
const fixOf = (code: string) => (code === "content.min_length" && props.length.total ? field(code, "fixCount") : props.coaching ? field(code, "coachFix") || field(code, "fix") : field(code, "fix"));
</script>

<template>
  <div class="picker" data-reason-picker>
    <p class="subtle picker__hint">{{ $t("reviewV2.decide.pickHint") }}</p>
    <fieldset v-for="g in groups" :key="g" class="group" :data-reason-group="g">
      <legend class="group__name">{{ $t(`reviewV2.decide.group.${g}`) }}</legend>
      <p v-if="g === 'setting' && fandom" class="subtle group__note" data-fandom-hint>{{ $t("reviewV2.decide.fandomHint") }}</p>
      <details v-if="g === 'opening' && opening.trim()" class="group__opening">
        <summary>{{ opening.trim().split("\n")[0] }}</summary>
        <p class="group__opening-text">{{ opening }}</p>
      </details>
      <label v-for="code in REVIEW_REASON_GROUPS[g]" :key="code" class="reason" :class="{ 'reason--locked': locked.includes(code) }">
        <input type="checkbox" :checked="checked(code)" :disabled="disabled || locked.includes(code)" :data-reason="code" @change="toggle(code, ($event.target as HTMLInputElement).checked)" />
        <span class="reason__text">
          <span class="reason__name">{{ $t(reasonKey(code, "name")) }}</span>
          <span class="reason__summary">{{ locked.includes(code) ? $t("reviewV2.decide.lengthAuto") : $t(reasonKey(code, "summary")) }}</span>
        </span>
      </label>
    </fieldset>

    <!-- 新人輔導：作者標記是新人時預設附完整改法與範例，可改回一般（ui.md §2.3） -->
    <div v-if="coachingDefault" class="coaching" data-coaching>
      <p v-if="coaching" class="coaching__text">{{ $t("reviewV2.decide.coachingOn") }}</p>
      <button type="button" class="btn btn--sm btn--ghost" :disabled="disabled" @click="emit('update:coaching', !coaching)">{{ coaching ? $t("reviewV2.decide.coachingOff") : $t("reviewV2.decide.coachingEnable") }}</button>
    </div>

    <section v-if="picked.length" class="preview" aria-live="polite" data-reason-preview>
      <h4 class="preview__title">{{ $t("reviewV2.decide.previewTitle") }}</h4>
      <article v-for="code in picked" :key="code" class="preview__item">
        <p class="preview__name">{{ $t(reasonKey(code, "name")) }}</p>
        <p>{{ fixOf(code) }}</p>
        <template v-if="coaching && field(code, 'before')">
          <p class="preview__ex"><span class="preview__label">{{ $t("reviewV2.author.before") }}</span>{{ field(code, "before") }}</p>
          <p class="preview__ex" data-after><span class="preview__label">{{ field(code, "afterLabel") || $t("reviewV2.author.after") }}</span>{{ field(code, "after") }}</p>
          <p v-if="field(code, 'afterChoices')" class="preview__ex" data-after-choices><span class="preview__label">{{ field(code, "afterChoicesLabel") }}</span>{{ field(code, "afterChoices") }}</p>
        </template>
        <p v-else-if="field(code, 'example')" class="preview__ex"><span class="preview__label">{{ $t("reviewV2.author.example") }}</span>{{ field(code, "example") }}</p>
        <div v-if="hasOptions(te, code)" class="preview__options" data-reason-options>
          <p class="preview__label">{{ $t(reasonOptionKey(code, "title")) }}</p>
          <ReviewReasonOptions :code="code" />
        </div>
      </article>
      <p v-if="hasOpeningReason(picked)" class="subtle">{{ $t("reviewV2.decide.previewOpening") }}</p>
    </section>
  </div>
</template>

<style scoped>
.picker { display: grid; gap: var(--s-3); min-width: 0; }
.picker__hint { margin: 0; }
/* fieldset 預設 min-inline-size: min-content：一行不換行的開場白會把整個決定區撐出螢幕（2026-11-23 owner 手機回報） */
.group { border: 0; margin: 0; padding: 0; display: grid; gap: var(--s-1); min-width: 0; min-inline-size: 0; }
.group__name { font-size: 14px; font-weight: 600; margin-bottom: var(--s-1); padding: 0; }
.group__note { margin: 0; font-size: 12px; }
.group__opening { font-size: 13px; color: var(--text-2); }
.group__opening { min-width: 0; }
/* 收合時只顯示一行、超出用省略號：要用 list-item 不用 flex，flex 裡的文字不會縮 */
.group__opening summary { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: var(--h-sm); line-height: var(--h-sm); display: list-item; }
.group__opening-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; margin: var(--s-1) 0 0; max-height: 240px; overflow-y: auto; }
.reason { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-2); align-items: start; padding: var(--s-2); min-height: var(--h-lg); border-radius: var(--r-sm); cursor: pointer; }
.reason:hover { background: var(--surface-2); }
.reason input { width: 18px; height: 18px; margin: 2px 0 0; }
.reason--locked { cursor: not-allowed; }
.reason__text { display: grid; gap: 2px; min-width: 0; }
.reason__name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.reason__summary { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
.coaching { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; justify-content: space-between; font-size: 13px; }
.coaching__text { margin: 0; color: var(--text-2); }
.preview { display: grid; gap: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.preview__title { margin: 0; font-size: 14px; }
.preview__item { display: grid; gap: var(--s-1); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; min-width: 0; }
.preview__options { display: grid; gap: var(--s-2); min-width: 0; margin-top: var(--s-1); }
.preview__item p { margin: 0; }
.preview__name { font-weight: 600; }
.preview__ex { color: var(--text-2); }
.preview__ex[data-after-choices] { white-space: pre-wrap; }
.preview__label { font-weight: 600; margin-inline-end: var(--s-2); color: var(--text); }
.picker:lang(ko) { word-break: keep-all; }
.picker:lang(ja) { word-break: auto-phrase; }
</style>
