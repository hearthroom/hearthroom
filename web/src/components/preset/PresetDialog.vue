<script setup lang="ts">
/** 預設頁的小彈層（匯出、另存副本、查看位置）：站上 modal 的寫法，Esc 關閉，關掉後焦點回到開它的按鈕。 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { wrapTab } from "@/lib/focus-trap";

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const box = ref<HTMLElement | null>(null);
const id = `preset-dialog-${Math.random().toString(36).slice(2)}`;

let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  (box.value?.querySelector<HTMLElement>("input, select, textarea") ?? box.value?.querySelector<HTMLElement>("button"))?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div ref="box" class="modal panel" role="dialog" aria-modal="true" :aria-labelledby="id">
        <h2 :id="id" class="modal__title">{{ title }}</h2>
        <slot />
        <div class="modal__actions"><slot name="actions" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal :deep(p) { margin: 0; }
@media (max-width: 480px) {
  .modal__actions { flex-direction: column-reverse; }
  .modal__actions :deep(.btn) { width: 100%; height: var(--h-lg); }
}
</style>
