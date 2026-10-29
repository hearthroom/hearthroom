<script setup lang="ts">
/**
 * 匯出成酒館預設。從酒館匯入的原樣帶回所有欄位（含綺夢社沒執行的部分）；
 * 在綺夢社寫的只用到酒館也支援的內容。兩句依來源擇一顯示。
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { exportRevision, type PresetSummary } from "@/lib/presets";
import { downloadBlob, safeFileName } from "@/lib/save-file";
import PresetDialog from "./PresetDialog.vue";

const props = defineProps<{ preset: Pick<PresetSummary, "id" | "headRevisionId" | "title" | "sourceKind">; token: () => Promise<string> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const busy = ref(false);
const state = ref<"" | "done" | "failed">("");

async function download() {
  busy.value = true;
  state.value = "";
  try {
    const { blob, filename } = await exportRevision(await props.token(), props.preset.id, props.preset.headRevisionId, safeFileName(props.preset.title, "preset"));
    downloadBlob(blob, filename);
    state.value = "done";
  } catch {
    state.value = "failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PresetDialog :title="t('preset.export.title')" @close="emit('close')">
    <p>{{ $t("preset.export.body") }}</p>
    <p class="muted">{{ $t(preset.sourceKind === "imported" ? "preset.export.imported" : "preset.export.native") }}</p>
    <p v-if="state" :class="state === 'failed' ? 'notice notice--error' : 'subtle'" role="status" data-testid="export-state">{{ $t(state === "done" ? "preset.export.done" : "preset.export.failed") }}</p>
    <template #actions>
      <button type="button" class="btn" @click="emit('close')">{{ $t("preset.inspect.close") }}</button>
      <button type="button" class="btn btn--primary" :disabled="busy" data-testid="export-download" @click="download">{{ $t("preset.export.download") }}</button>
    </template>
  </PresetDialog>
</template>
