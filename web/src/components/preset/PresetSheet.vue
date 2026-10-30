<script setup lang="ts">
/**
 * 分享用的彈層（公開、檢舉）：標題旁一顆關閉鈕，沒有另外的「取消」——點外面、Esc、關閉鈕都是取消
 * （owner 看完原型 2026-10-30：公開彈層不要空白的取消鈕）。窄螢幕照站上 modal 的寫法移到底部。
 * 關掉後焦點回到開它的按鈕。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { wrapTab } from "@/lib/focus-trap";

defineProps<{ title: string; testid?: string }>();
const emit = defineEmits<{ close: [] }>();
const box = ref<HTMLElement | null>(null);
const id = `preset-sheet-${Math.random().toString(36).slice(2)}`;

let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  (box.value?.querySelector<HTMLElement>("[data-autofocus]") ?? box.value?.querySelector<HTMLElement>("input, textarea, button"))?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div ref="box" class="modal panel sheet" role="dialog" aria-modal="true" :aria-labelledby="id" :data-testid="testid">
        <div class="sheet__head">
          <h2 :id="id" class="modal__title sheet__title">{{ title }}</h2>
          <button type="button" class="btn btn--icon btn--ghost sheet__close" :aria-label="$t('preset.share.close')" data-testid="sheet-close" @click="emit('close')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet { width: min(440px, 100%); gap: var(--s-3); }
.sheet :deep(p) { margin: 0; }
.sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-3); }
.sheet__title { margin: 0; padding-top: 6px; overflow-wrap: anywhere; }
.sheet__close { flex: none; width: var(--h-lg); height: var(--h-lg); margin: calc(-1 * var(--s-2)) calc(-1 * var(--s-2)) 0 0; }
</style>
