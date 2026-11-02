<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useAppearance } from "@/lib/appearance";
import AppearanceControls from "./AppearanceControls.vue";

const { resolvedMode } = useAppearance();
const props = defineProps<{ external?: boolean }>();
let externalOpener: HTMLElement | null = null;
function openFrom(opener: HTMLElement | null) {
  externalOpener = opener; open.value = true;
  void nextTick(() => root.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
}
defineExpose({ openFrom });
import { useHeaderOverlay } from "@/lib/site-links";
const open = ref(false);
useHeaderOverlay(open);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
  if (open.value) void nextTick(() => panel.value?.querySelector<HTMLElement>("[aria-checked='true']")?.focus());
}
function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) { open.value = false; (externalOpener ?? root.value?.querySelector<HTMLElement>("button"))?.focus(); }
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div ref="root" class="ap" :class="{ 'is-external': props.external }">
    <!-- 圖示畫的是現在生效的那一種：白天是太陽、晚上是月亮 -->
    <button v-if="!props.external" class="ap__btn" :aria-label="$t('appearance.title')" :aria-expanded="open" @click="toggle">
      <svg v-if="resolvedMode === 'dark'" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <svg v-else viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <!-- 非模態的設定面板：Tab 走得出去、點外面就收，不裝成對話框 -->
    <div v-if="open" ref="panel" class="ap__panel panel" data-discovery-overlay role="group" :aria-label="$t('appearance.title')">
      <AppearanceControls />
    </div>
  </div>
</template>

<style scoped>
.ap { position: relative; }
.ap__btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  background: transparent; border: 0; border-radius: var(--r-pill);
  color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.ap__btn:hover, .ap__btn[aria-expanded="true"] { background: var(--surface-2); color: var(--text); }
.ap__btn svg { width: 18px; height: 18px; }

.ap__panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  width: 264px; padding: 12px;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: pop var(--dur) var(--ease);
}
@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }

/* 手機：錨在圖示右緣會被左邊切掉；改成貼著頁首橫跨整寬 */
@media (max-width: 860px) {
  .ap__panel { position: fixed; top: 60px; right: 12px; left: 12px; width: auto; }
}
/* 觸控目標放大（選擇器本身的放大在 AppearanceControls） */
@media (max-width: 480px) {
  .ap__panel { padding: 14px; }
}
.is-external { position: static; }
.is-external .ap__panel { position: fixed; top: calc(var(--site-header-h, var(--header-h)) + var(--s-2)); right: var(--s-3); left: auto; width: min(280px, calc(100vw - 24px)); max-height: calc(100dvh - var(--site-header-h, var(--header-h)) - var(--s-5)); overflow-y: auto; }
</style>
