<script setup lang="ts">
/**
 * 工坊的短回饋：說完就走（3.2 秒），可帶一顆「復原」。live region 常駐、用 hidden 切，讀屏器才會唸。
 * 用法：const toast = ref<InstanceType<typeof UndoToast>>(); toast.value?.say(text, undo?)
 */
import { onBeforeUnmount, ref } from "vue";

const text = ref("");
let undoFn: (() => void) | null = null;
const hasUndo = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
function say(next: string, undo?: () => void) {
  text.value = next; undoFn = undo ?? null; hasUndo.value = !!undo;
  clearTimeout(timer);
  timer = setTimeout(() => { text.value = ""; undoFn = null; hasUndo.value = false; }, undo ? 6000 : 3200);
}
function undo() { const fn = undoFn; text.value = ""; undoFn = null; hasUndo.value = false; fn?.(); }
onBeforeUnmount(() => clearTimeout(timer));
defineExpose({ say });
</script>

<template>
  <Teleport to="body">
    <div class="toast ws-toast" role="status" :hidden="!text">
      <span>{{ text }}</span>
      <button v-if="hasUndo" type="button" class="ws-toast__undo" @click="undo">{{ $t("workshop.toast.undo") }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.ws-toast { display: flex; align-items: center; gap: var(--s-3); max-width: calc(100vw - var(--s-4) * 2); box-sizing: border-box; }
.ws-toast__undo { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
@media (max-width: 820px) { .ws-toast { bottom: calc(var(--h-lg) + var(--s-3) * 3 + env(safe-area-inset-bottom)); } }
</style>
