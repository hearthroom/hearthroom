<script setup lang="ts">
/**
 * 數值面板皮膚的預覽：跟遊玩畫布同一支 renderStatePanelSkin（模板渲染＋皮膚樣式加 .lt-state-skin 前綴），
 * 皮膚也放在同一個容器 class 裡，玩家看到什麼這裡就是什麼。畫在不跑腳本的 iframe 裡，
 * 皮膚自帶的 CSS 不會漏到建卡頁。作者看得到錯在哪一行。
 */
import { computed } from "vue";
import { renderStatePanelSkin, STATE_PANEL_SKIN_CLASS } from "stage-panel/state-panel";

const props = defineProps<{ template: string; data: unknown }>();
const result = computed(() => (props.template.trim() ? renderStatePanelSkin(props.template, props.data, [], "author") : null));
// 容器的版面規則照遊玩畫布的面板（canvas.css 的 .lt-state-skin）
const doc = computed(() =>
  `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:light dark}body{margin:8px;font:14px/1.5 system-ui,sans-serif}`
  + `.${STATE_PANEL_SKIN_CLASS}{min-height:0;overflow:auto;overflow-wrap:anywhere;contain:paint}</style>`
  + `<div class="${STATE_PANEL_SKIN_CLASS}">${result.value?.html ?? ""}</div>`,
);
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
