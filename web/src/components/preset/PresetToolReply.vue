<script setup lang="ts">
/**
 * 「用工具回覆」：玩家明確打開才用綺夢社自己的回覆工具（整段生成後才顯示）。匯入時一律關著；
 * 來源預設靠酒館擴充功能用工具回覆時只提示（打開後就收起），不替玩家打開。匯入報告與編輯頁共用。
 */
defineProps<{ enabled: boolean; detected?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
const id = `tool-reply-${Math.random().toString(36).slice(2)}`;
</script>

<template>
  <div class="tool-reply" data-testid="preset-tool-reply">
    <label class="tool-reply__row">
      <input type="checkbox" :checked="enabled" :disabled="disabled" :aria-describedby="id" data-testid="preset-tool-reply-toggle"
        @change="emit('change', ($event.target as HTMLInputElement).checked)" />
      <span class="tool-reply__label">{{ $t("preset.toolReply.label") }}</span>
    </label>
    <p :id="id" class="subtle tool-reply__hint">{{ $t("preset.toolReply.hint") }}</p>
    <p v-if="detected && !enabled" class="notice tool-reply__detected" data-testid="preset-tool-reply-detected">{{ $t("preset.toolReply.detected") }}</p>
  </div>
</template>

<style scoped>
.tool-reply { display: grid; gap: var(--s-1); }
.tool-reply__row { display: inline-flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); cursor: pointer; justify-self: start; }
/* 跟條目列的勾選框同一個樣子 */
.tool-reply__row input { width: 18px; height: 18px; margin: 0; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.tool-reply__label { font-weight: 600; }
.tool-reply__hint { margin: 0 0 0 26px; font-size: 13px; text-wrap: pretty; }
.tool-reply__detected { margin: var(--s-1) 0 0; text-wrap: pretty; }
</style>
