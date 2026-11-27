<script setup lang="ts">
import { useId } from "vue";
import CoverEye from "@/components/CoverEye.vue";
import CoverImg from "@/components/CoverImg.vue";
defineProps<{ cover: string; reviewed: boolean; disabled?: boolean }>();
const value = defineModel<boolean>({ required: true });
const id = useId();
</script>

<template>
  <div class="cover-field">
    <button type="button" class="ws-switch cover-field__toggle" role="switch" :aria-checked="value"
      :aria-labelledby="id + '-label'" :aria-describedby="id + '-hint'" :disabled="disabled || !cover"
      @click="value = !value" />
    <div class="cover-field__text">
      <strong :id="id + '-label'">{{ $t("coverSensitive.authorSwitch") }}</strong>
      <p :id="id + '-hint'">{{ $t(cover ? "coverSensitive.authorHint" : "coverSensitive.uploadFirst") }}</p>
      <p v-if="reviewed">{{ $t("coverSensitive.reviewerOnlyClear") }}</p>
    </div>
    <div v-if="cover && (value || reviewed)" class="cover-field__preview" :aria-label="$t('coverSensitive.listPreview')" role="img">
      <CoverImg :src="cover" sensitive />
      <CoverEye />
    </div>
  </div>
</template>

<style scoped>
.cover-field { display: flex; align-items: flex-start; gap: var(--s-3); min-height: 48px; padding-block: var(--s-2); }
.cover-field__toggle { position: relative; flex: none; margin: var(--s-2) 2px; }
.cover-field__toggle::before { content: ""; position: absolute; inset: -10px -3px; }
.cover-field__text { flex: 1; min-width: 0; overflow-wrap: anywhere; padding-top: var(--s-1); }
.cover-field__text strong { font-size: 14px; }
.cover-field__text p { margin: var(--s-1) 0 0; font-size: 12px; color: var(--text-2); }
.cover-field__preview { position: relative; width: 84px; flex: none; aspect-ratio: 3/4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.cover-field__preview img { width: 100%; height: 100%; object-fit: cover; filter: blur(8.4px); transform: scale(1.16); }
.cover-field__preview::after { content: ""; position: absolute; inset: 0; background: rgba(16,16,19,.52); }
.cover-field__preview svg { position: absolute; z-index: 1; inset: 0; margin: auto; width: 16px; color: white; }
</style>
