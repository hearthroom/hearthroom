<script setup lang="ts">
/**
 * 待審清單每一列的「⋯」（審卡 V2，ui.md §2.1）：第一項「不受理」一步完成、不跳確認（零成本是這個功能的重點），
 * 第二項「冷凍並討論」在清單上停用並說明要先領取。別人領著、冷凍中的卡不能不受理，選項停用並寫原因。
 *
 * 浮層錨在按鈕上、非模態（跟分享、打賞同一套）：z 40、Esc 與點外面關閉、關閉後焦點回到按鈕。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ name: string; blocked: "claimed" | "held" | null; busy?: boolean }>();
const emit = defineEmits<{ drop: [] }>();

const open = ref(false);
const up = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function place() {
  const box = root.value?.getBoundingClientRect();
  if (!box) return;
  const wanted = panel.value?.scrollHeight ?? 160;
  up.value = innerHeight - box.bottom - 12 < wanted && box.top > innerHeight - box.bottom;
}
function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  void nextTick(() => {
    place();
    panel.value?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  });
}
function close(focusBack = false) {
  open.value = false;
  if (focusBack) root.value?.querySelector<HTMLElement>(".row-menu__trigger")?.focus();
}
function pick() {
  close(true);
  emit("drop");
}
function outside(e: PointerEvent) { if (open.value && !root.value?.contains(e.target as Node)) close(); }
function key(e: KeyboardEvent) { if (open.value && e.key === "Escape") { e.stopPropagation(); close(true); } }
onMounted(() => { document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key); });
onBeforeUnmount(() => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); });
</script>

<template>
  <div ref="root" class="row-menu">
    <button class="btn btn--ghost btn--icon row-menu__trigger" type="button" :aria-label="$t('reviewV2.menu.open')" :aria-expanded="open" aria-haspopup="menu" :disabled="props.busy" data-row-menu @click="toggle">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /></svg>
    </button>
    <div v-if="open" ref="panel" class="row-menu__panel" :class="{ 'row-menu__panel--up': up }" role="menu" :aria-label="props.name">
      <button class="row-menu__item" role="menuitem" type="button" :disabled="!!props.blocked" data-menu-drop @click="pick">
        <span class="row-menu__label">{{ $t("reviewV2.menu.drop") }}</span>
        <span class="row-menu__hint">{{ props.blocked === "claimed" ? $t("reviewV2.menu.claimedByOther") : props.blocked === "held" ? $t("reviewV2.menu.held") : $t("reviewV2.menu.dropHint") }}</span>
      </button>
      <button class="row-menu__item" role="menuitem" type="button" disabled>
        <span class="row-menu__label">{{ $t("reviewV2.menu.hold") }}</span>
        <span class="row-menu__hint">{{ $t("reviewV2.menu.holdHint") }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.row-menu { position: relative; display: inline-flex; }
.row-menu__trigger { width: var(--h-lg); height: var(--h-lg); }
.row-menu__panel { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; width: min(280px, calc(100vw - var(--s-6)));
  display: grid; padding: var(--s-1); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-md); }
.row-menu__panel--up { top: auto; bottom: calc(100% + 4px); }
.row-menu__item { display: grid; gap: 2px; text-align: left; padding: var(--s-2) var(--s-3); min-height: var(--h-lg); border: 0; background: transparent; border-radius: var(--r-sm); color: var(--text); cursor: pointer; font: inherit; }
.row-menu__item:hover:not(:disabled) { background: var(--surface-2); }
.row-menu__item:disabled { cursor: not-allowed; }
.row-menu__item:disabled .row-menu__label { color: var(--text-3); }
.row-menu__label { font-size: 14px; font-weight: 600; }
.row-menu__hint { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
.row-menu__hint:lang(ko) { word-break: keep-all; }
</style>
