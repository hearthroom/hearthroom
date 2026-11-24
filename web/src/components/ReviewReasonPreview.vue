<script setup lang="ts">
/**
 * 「作者會看到」：每個理由的怎麼改與範例（輔導時是完整改法與改前改後），有「給選項的三種做法」的代碼附上那一塊，
 * 有開場白理由時多一行「並附上好開場的三個要素」。
 *
 * 駁回理由選擇器的即時預覽與兩段式定案（選「用我的」「用 AI 的」時作者會看到什麼）共用這一份。
 * 婉拒（ui-decline.md）：作者收到的回覆放在最前面（小標「給作者的回覆」），其他理由接在後面，並註明這個順序。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { declineReply, hasOpeningReason, hasOptions, isDeclineReason, reasonKey, reasonOptionKey } from "@/lib/review-reasons";
import ReviewReasonOptions from "@/components/ReviewReasonOptions.vue";

const props = defineProps<{
  codes: readonly string[]; coaching: boolean;
  length: { total?: string; remaining?: string; required?: string };
  title?: string;
}>();
const { t, te } = useI18n();

// 字數參數：伺服器給的是 remaining，字串用的是 {gap}（跟作者端同一個鍵）
const params = computed(() => ({ ...props.length, gap: props.length.remaining ?? "" }));
const field = (code: string, name: Parameters<typeof reasonKey>[1]) => (te(reasonKey(code, name)) ? t(reasonKey(code, name), params.value) : "");
const reply = computed(() => declineReply(t, props.codes));
const others = computed(() => props.codes.filter((c) => !isDeclineReason(c)));
const fixOf = (code: string) => (code === "content.min_length" && props.length.total ? field(code, "fixCount") : props.coaching ? field(code, "coachFix") || field(code, "fix") : field(code, "fix"));
</script>

<template>
  <section v-if="codes.length" class="preview" aria-live="polite" data-reason-preview>
    <h4 class="preview__title">{{ title || t("reviewV2.decide.previewTitle") }}</h4>
    <article v-if="reply" class="preview__item" data-decline-preview>
      <p class="preview__name">{{ t("review.reasons.decline.previewLabel") }}</p>
      <p>{{ reply }}</p>
    </article>
    <p v-if="reply && others.length" class="subtle" data-decline-order>{{ t("review.reasons.decline.orderHint") }}</p>
    <article v-for="code in others" :key="code" class="preview__item">
      <p class="preview__name">{{ t(reasonKey(code, "name")) }}</p>
      <p>{{ fixOf(code) }}</p>
      <template v-if="coaching && field(code, 'before')">
        <p class="preview__ex"><span class="preview__label">{{ t("reviewV2.author.before") }}</span>{{ field(code, "before") }}</p>
        <p class="preview__ex" data-after><span class="preview__label">{{ field(code, "afterLabel") || t("reviewV2.author.after") }}</span>{{ field(code, "after") }}</p>
        <p v-if="field(code, 'afterChoices')" class="preview__ex" data-after-choices><span class="preview__label">{{ field(code, "afterChoicesLabel") }}</span>{{ field(code, "afterChoices") }}</p>
      </template>
      <p v-else-if="field(code, 'example')" class="preview__ex"><span class="preview__label">{{ t("reviewV2.author.example") }}</span>{{ field(code, "example") }}</p>
      <div v-if="hasOptions(te, code)" class="preview__options" data-reason-options>
        <p class="preview__label">{{ t(reasonOptionKey(code, "title")) }}</p>
        <ReviewReasonOptions :code="code" />
      </div>
    </article>
    <p v-if="hasOpeningReason(codes)" class="subtle" data-preview-opening>{{ t("reviewV2.decide.previewOpening") }}</p>
  </section>
</template>

<style scoped>
.preview { display: grid; gap: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); min-width: 0; }
.preview__title { margin: 0; font-size: 14px; }
.preview__item { display: grid; gap: var(--s-1); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; min-width: 0; }
.preview__options { display: grid; gap: var(--s-2); min-width: 0; margin-top: var(--s-1); }
.preview__item p { margin: 0; }
.preview > .subtle { margin: 0; }
.preview__name { font-weight: 600; }
.preview__ex { color: var(--text-2); }
.preview__ex[data-after-choices] { white-space: pre-wrap; }
.preview__label { font-weight: 600; margin-inline-end: var(--s-2); color: var(--text); }
.preview:lang(ko) { word-break: keep-all; }
.preview:lang(ja) { word-break: auto-phrase; }
</style>
