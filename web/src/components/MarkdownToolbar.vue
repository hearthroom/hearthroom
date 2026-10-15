<script setup lang="ts">
/** 編輯器的格式工具列：每顆鍵發出一個動作，由編輯器套到內文的游標或選取範圍上。手機上可以橫向捲動。 */
import { useI18n } from 'vue-i18n';
import type { MarkdownAction } from '@/lib/markdown-edit';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ act: [MarkdownAction] }>();
const { t } = useI18n();

type Tool = { action: MarkdownAction; text?: string; icon?: string; strong?: boolean; em?: boolean };
/** 圖示都是 16×16、描邊 1.4 的線條 */
const TOOLS: Tool[] = [
  { action: 'h2', text: 'H2' },
  { action: 'h3', text: 'H3' },
  { action: 'bold', text: 'B', strong: true },
  { action: 'italic', text: 'I', em: true },
  { action: 'link', icon: 'M6.6 9.4l2.8-2.8M7.2 4.6l.9-.9a2.6 2.6 0 013.7 3.7l-.9.9M8.8 11.4l-.9.9a2.6 2.6 0 01-3.7-3.7l.9-.9' },
  { action: 'quote', icon: 'M3 5h3.5v3.5H4.6L3.8 11M9.5 5H13v3.5h-1.9L10.3 11' },
  { action: 'ul', icon: 'M6.5 4.5h7M6.5 8h7M6.5 11.5h7M3 4.5h.01M3 8h.01M3 11.5h.01' },
  { action: 'ol', icon: 'M6.5 4.5h7M6.5 8h7M6.5 11.5h7M2.6 3.5h.9v2.5M2.5 9.6c.3-.4.6-.6 1-.6.5 0 .9.3.9.8 0 .7-1.9 1.4-1.9 2.2h1.9' },
  { action: 'table', icon: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M7 6.5v6' },
  { action: 'code', icon: 'M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3' },
  { action: 'image', icon: 'M2.5 3.5h11v9h-11zM5.8 7a1 1 0 100-.01M13.5 10.3L10.3 7.3 4.5 12.5' },
];
</script>

<template>
  <div class="mdt" role="toolbar" :aria-label="t('blog.admin.md.toolbar')">
    <button v-for="tool in TOOLS" :key="tool.action" type="button" class="mdt__btn" :data-md="tool.action" :disabled="disabled"
            :aria-label="t(`blog.admin.md.${tool.action}`)" :title="t(`blog.admin.md.${tool.action}`)" @mousedown.prevent @click="emit('act', tool.action)">
      <svg v-if="tool.icon" viewBox="0 0 16 16" aria-hidden="true"><path :d="tool.icon" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span v-else aria-hidden="true" :class="{ 'mdt__b': tool.strong, 'mdt__i': tool.em }">{{ tool.text }}</span>
    </button>
  </div>
</template>

<style scoped>
.mdt { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; padding: 2px 0; border-bottom: 1px solid var(--line); }
.mdt::-webkit-scrollbar { display: none; }
.mdt__btn { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-2); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.mdt__btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.mdt__btn:disabled { opacity: 0.5; cursor: default; }
.mdt__btn svg { width: 16px; height: 16px; }
.mdt__b { font-weight: 800; }
.mdt__i { font-style: italic; font-family: Georgia, serif; }
@media (max-width: 760px) { .mdt { margin: 0 calc(-1 * var(--s-4)); padding: 2px var(--s-4); } .mdt__btn { width: 44px; height: 44px; } }
</style>
