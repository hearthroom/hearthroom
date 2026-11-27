<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ReviewerCoverState } from "@/lib/api";
import CoverImg from "./CoverImg.vue";
import CoverEye from "./CoverEye.vue";

const props = defineProps<{
  cover: string | null;
  state: ReviewerCoverState;
  disabled?: boolean;
  submit: (body: { sensitive: boolean; reason: string; operationId: string }) => Promise<ReviewerCoverState>;
}>();
const emit = defineEmits<{ updated: [state: ReviewerCoverState]; busy: [busy: boolean] }>();
const { t } = useI18n();
const reason = ref("");
const busy = ref(false);
const failed = ref(false);
const success = ref<boolean>();
const next = computed(() => !props.state.coverReviewSensitive);
const effectiveAfter = computed(() => !!props.cover && (next.value || props.state.coverAuthorSensitive));
let attempt: { sensitive: boolean; reason: string; operationId: string } | undefined;

async function save() {
  const why = reason.value.trim();
  if (busy.value || !why || props.disabled || (!props.cover && next.value)) return;
  if (!attempt || attempt.sensitive !== next.value || attempt.reason !== why) {
    attempt = { sensitive: next.value, reason: why, operationId: crypto.randomUUID() };
  }
  const request = attempt;
  failed.value = false;
  busy.value = true;
  emit("busy",true);
  try {
    const updated = await props.submit(request);
    emit("updated",updated);
    success.value = request.sensitive;
    attempt = undefined;
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
    emit("busy",false);
  }
}
function again() {
  reason.value = "";
  success.value = undefined;
}
</script>

<template>
  <div class="cover-mark">
    <div v-if="success !== undefined" class="notice" role="status">
      <strong>{{ t(success ? "coverSensitive.marked" : "coverSensitive.cleared") }}</strong>
      <button type="button" class="btn btn--ghost" @click="again">{{ t("coverSensitive.changeAgain") }}</button>
    </div>
    <template v-else>
      <div class="cover-mark__states">
        <span class="chip">{{ t("coverSensitive.authorState", { status: t(state.coverAuthorSensitive ? "coverSensitive.on" : "coverSensitive.off") }) }}</span>
        <span class="chip">{{ t("coverSensitive.reviewState", { status: t(state.coverReviewSensitive ? "coverSensitive.on" : "coverSensitive.off") }) }}</span>
        <span class="chip">{{ t(state.coverSensitive ? "coverSensitive.blurred" : "coverSensitive.clear") }}</span>
      </div>
      <p v-if="state.coverChanged" class="notice">{{ t("coverSensitive.coverChanged") }}</p>
      <div v-if="cover" class="cover-mark__comparison">
        <figure><figcaption>{{ t("coverSensitive.currentCover") }}</figcaption><CoverImg :src="cover" /></figure>
        <figure>
          <figcaption>{{ t("coverSensitive.listAfter") }}</figcaption>
          <div class="cover-mark__art" :class="{ 'cover-mark__art--blurred': effectiveAfter }">
            <CoverImg :src="cover" :sensitive="effectiveAfter" />
            <CoverEye v-if="effectiveAfter" />
          </div>
        </figure>
      </div>
      <p v-if="!next && state.coverAuthorSensitive">{{ t("coverSensitive.remainsBlurred") }}</p>
      <p v-if="disabled" class="notice">{{ t("coverSensitive.noPermission") }}</p>
      <label class="cover-mark__reason">{{ t("moderation.reason") }}
        <textarea v-model="reason" class="input" rows="3" maxlength="500" :disabled="busy || disabled" />
      </label>
      <p v-if="failed" class="notice notice--error" role="alert">{{ t("coverSensitive.saveFailed") }}</p>
      <button type="button" class="btn btn--primary" :disabled="busy || disabled || !reason.trim() || (next && !cover)" @click="save">
        {{ t(failed ? "coverSensitive.retry" : next ? "coverSensitive.mark" : "coverSensitive.unmark") }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.cover-mark { display: grid; gap: var(--s-3); min-width: 0; }
.cover-mark__states { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.cover-mark__comparison { display: flex; flex-wrap: wrap; gap: var(--s-3); }
.cover-mark figure { margin: 0; max-width: 112px; }
.cover-mark figcaption { font-size: 12px; color: var(--text-2); margin-bottom: var(--s-1); }
.cover-mark img, .cover-mark__art { display: block; width: 112px; max-width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: var(--r-sm); background: var(--surface-2); }
.cover-mark__art { position: relative; overflow: hidden; }
.cover-mark__art--blurred img { filter: blur(11.2px); transform: scale(1.16); }
.cover-mark__art--blurred::after { content: ""; position: absolute; inset: 0; background: rgba(16,16,19,.52); }
.cover-mark__art svg { position: absolute; inset: 0; margin: auto; z-index: 1; width: 16px; color: white; }
.cover-mark__reason { display: grid; gap: var(--s-2); }
.cover-mark p { margin: 0; }
.cover-mark > .btn { justify-self: start; }
@media (max-width: 480px) { .cover-mark > .btn { justify-self: stretch; } }
</style>
