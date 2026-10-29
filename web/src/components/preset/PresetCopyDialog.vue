<script setup lang="ts">
/** 另存副本：建一份獨立的預設，原本的預設和正在用它的對話都不變。 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { copyPreset, resultUnknown, type PresetSummary, type WriteReceipt } from "@/lib/presets";
import { operationKeys } from "@/lib/use-preset-access";
import PresetDialog from "./PresetDialog.vue";

const props = defineProps<{ source: PresetSummary; token: () => Promise<string> }>();
const emit = defineEmits<{ close: []; done: [receipt: WriteReceipt, name: string] }>();
const { t } = useI18n();
const ops = operationKeys();
const name = ref(t("preset.copy.name.default", { name: props.source.title }).slice(0, 60));
const busy = ref(false);
const error = ref("");

async function submit() {
  const title = name.value.trim();
  if (!title || busy.value) return;
  busy.value = true;
  error.value = "";
  const action = `copy:${props.source.id}:${title}`;
  try {
    const receipt = await copyPreset(await props.token(), props.source.id, title, ops.key(action));
    ops.done(action);
    emit("done", receipt, title);
  } catch (err) {
    if (!resultUnknown(err)) ops.done(action);
    error.value = resultUnknown(err) ? t("preset.error.unknown") : err instanceof ApiError || err instanceof Error ? err.message : t("preset.error.unavailable");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PresetDialog :title="t('preset.copy.title')" @close="emit('close')">
    <p class="muted">{{ $t("preset.copy.body") }}</p>
    <div class="field">
      <label for="preset-copy-name">{{ $t("preset.copy.name") }}</label>
      <input id="preset-copy-name" v-model="name" class="input" maxlength="60" data-testid="copy-name" @keydown.enter.prevent="submit" />
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <template #actions>
      <button type="button" class="btn" @click="emit('close')">{{ $t("preset.copy.cancel") }}</button>
      <button type="button" class="btn btn--primary" :disabled="busy || !name.trim()" data-testid="copy-confirm" @click="submit">{{ $t("preset.copy.confirm") }}</button>
    </template>
  </PresetDialog>
</template>
