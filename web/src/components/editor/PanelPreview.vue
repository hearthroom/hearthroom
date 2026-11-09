<script setup lang="ts">
/**
 * 數值面板皮膚的預覽：用遊玩畫布同一份渲染器，畫在不跑腳本的 iframe 裡，
 * 皮膚自帶的 CSS 不會漏到建卡頁。作者看得到錯在哪一行。
 */
import { computed } from "vue";
import { renderPanel } from "stage-panel/handlebars-lite";

const props = defineProps<{ template: string; data: unknown }>();
const result = computed(() => (props.template.trim() ? renderPanel(props.template, props.data, { audience: "author" }) : null));
const doc = computed(() => `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:light dark}body{margin:8px;font:14px/1.5 system-ui,sans-serif}</style>${result.value?.html ?? ""}`);
</script>

<template>
  <div v-if="result" class="ppreview">
    <span class="ppreview__label">{{ $t("editor.state.preview") }}</span>
    <p v-if="result.error" class="ppreview__error" role="alert">
      {{ $t("editor.state.preview.error", { line: result.error.line, message: result.error.message }) }}
    </p>
    <iframe v-else class="ppreview__frame" sandbox="" :srcdoc="doc" :title="$t('editor.state.preview')" />
  </div>
</template>

<style scoped>
.ppreview { display: grid; gap: var(--s-1); margin-top: var(--s-2); }
.ppreview__label { font-size: 13px; font-weight: 600; }
.ppreview__error { color: var(--danger, #c0392b); font-size: 13px; margin: 0; }
.ppreview__frame { width: 100%; min-height: 160px; border: 1px solid var(--line); border-radius: var(--r-2, 8px); background: var(--surface); }
</style>
