<script setup lang="ts">
/**
 * 檢舉一份公開的預設：四類原因選一個，補充說明選填（≤500 字）。送出後彈層裡直接換成「已收到」，
 * 詳情頁之後一直標「你已檢舉」。上游不回參考編號，所以不顯示。送出失敗留在框裡，選的原因與說明都還在。
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { REPORT_REASONS, reportPreset, type PresetReportReason } from "@/lib/presets";
import PresetSheet from "./PresetSheet.vue";

const props = defineProps<{ presetId: string; title: string; token: () => Promise<string> }>();
const emit = defineEmits<{ close: []; reported: []; consent: [err: unknown] }>();
const { t } = useI18n();

const DETAIL_MAX = 500;
const reason = ref<PresetReportReason | null>(null);
const detail = ref("");
const sending = ref(false);
const error = ref("");
const done = ref(false);

async function submit() {
  if (!reason.value || sending.value) return;
  sending.value = true;
  error.value = "";
  try {
    await reportPreset(await props.token(), props.presetId, reason.value, detail.value.trim().slice(0, DETAIL_MAX));
    done.value = true;
    emit("reported");
  } catch (err) {
    emit("consent", err);
    error.value = t("preset.share.error.report");
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <PresetSheet :title="done ? t('preset.share.report.done.title') : t('preset.share.report.title', { name: title })" testid="report-sheet" @close="emit('close')">
    <template v-if="done">
      <p class="muted" role="status" data-testid="report-done">{{ $t("preset.share.report.done.body") }}</p>
      <button type="button" class="btn btn--lg report__wide" data-autofocus @click="emit('close')">{{ $t("preset.share.report.done.back") }}</button>
    </template>
    <form v-else class="report" @submit.prevent="submit">
      <fieldset class="report__reasons">
        <legend class="report__label">{{ $t("preset.share.report.reason") }}</legend>
        <label v-for="r in REPORT_REASONS" :key="r" class="report__reason">
          <input v-model="reason" type="radio" name="preset-report-reason" :value="r" :data-testid="`report-reason-${r}`" />
          <span>{{ $t(`preset.share.report.reason.${r}`) }}</span>
        </label>
      </fieldset>
      <label class="report__field">
        <span class="report__label">{{ $t("preset.share.report.details.label") }}</span>
        <textarea v-model="detail" autocomplete="off" class="input" rows="3" :maxlength="DETAIL_MAX" :placeholder="$t('preset.share.report.details.placeholder')" data-testid="report-detail" />
      </label>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div class="modal__actions">
        <button type="button" class="btn" @click="emit('close')">{{ $t("preset.share.report.cancel") }}</button>
        <button type="submit" class="btn btn--primary" :disabled="!reason || sending" data-testid="report-submit">{{ $t("preset.share.report.submit") }}</button>
      </div>
    </form>
  </PresetSheet>
</template>

<style scoped>
.report { display: grid; gap: var(--s-3); }
.report__label { font-size: 13px; font-weight: 600; padding: 0; margin-bottom: var(--s-1); }
.report__reasons { margin: 0; padding: 0; border: 0; display: grid; gap: 2px; }
.report__reason { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); padding: 0 var(--s-3); border-radius: var(--r-sm); font-size: 14px; cursor: pointer; }
.report__reason:hover { background: var(--surface-2); }
.report__reason input { margin: 0; width: 18px; height: 18px; accent-color: var(--accent); }
.report__field { display: grid; gap: 6px; }
.report__wide { width: 100%; }
</style>
