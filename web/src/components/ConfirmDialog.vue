<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { confirmDialog, confirmState, settleConfirm } from "@/lib/confirm";

const box = ref<HTMLElement | null>(null);
/** 開啟前的焦點：關掉時還回去，鍵盤使用者不會掉到頁面開頭 */
let restore: HTMLElement | null = null;

watch(() => confirmState.current, async (cur) => {
  if (!cur) { restore?.focus?.(); restore = null; return; }
  restore = document.activeElement as HTMLElement | null;
  await nextTick();
  // 破壞性動作先站在取消鍵上：按錯 Enter 也不會刪掉東西
  const pick = cur.danger && !cur.single ? "[data-cancel]" : "[data-confirm]";
  box.value?.querySelector<HTMLElement>(pick)?.focus();
});

function onKey(e: KeyboardEvent) {
  if (!confirmState.current) return;
  if (e.key === "Escape") { e.preventDefault(); settleConfirm(false); return; }
  // 焦點只在彈窗裡繞
  if (e.key === "Tab" && box.value) {
    const items = [...box.value.querySelectorAll<HTMLElement>("button, [tabindex='0']")];
    if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
onMounted(() => {
  document.addEventListener("keydown", onKey);
  if (import.meta.env.DEV) (window as unknown as { __confirmDialog: typeof confirmDialog }).__confirmDialog = confirmDialog;
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.current" class="dlg-backdrop" @click.self="settleConfirm(false)">
      <div ref="box" class="dlg panel" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title" class="dlg__title">{{ confirmState.current.title ?? confirmState.current.message }}</h2>
        <p v-if="confirmState.current.title" id="dlg-msg" class="dlg__msg">{{ confirmState.current.message }}</p>
        <!-- 要讓人複製的東西：一整塊可全選，點一下就選起來 -->
        <code v-if="confirmState.current.detail" class="dlg__detail" tabindex="0" @click="($event.target as HTMLElement).ownerDocument.getSelection()?.selectAllChildren($event.target as Node)">{{ confirmState.current.detail }}</code>
        <div class="dlg__actions">
          <button v-if="!confirmState.current.single" class="btn" data-cancel @click="settleConfirm(false)">
            {{ confirmState.current.cancelText ?? $t("dialog.cancel") }}
          </button>
          <button class="btn" :class="confirmState.current.danger ? 'btn--danger-solid' : 'btn--primary'" data-confirm @click="settleConfirm(true)">
            {{ confirmState.current.confirmText ?? $t("dialog.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed; inset: 0; z-index: 100;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: fade var(--dur) var(--ease);
}
.dlg {
  width: min(400px, 100%);
  padding: var(--s-5) var(--s-5) var(--s-4);
  display: grid; gap: var(--s-3);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: pop var(--dur-slow) var(--ease);
}
.dlg__title { font-size: 16px; font-weight: 600; line-height: 1.4; }
.dlg__msg { font-size: 14px; line-height: 1.6; color: var(--text-2); }
.dlg__detail {
  display: block; padding: 10px 12px;
  border-radius: var(--r-sm); background: var(--surface-2);
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
  overflow-wrap: anywhere; user-select: all; cursor: text;
}
.dlg__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }

@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

@media (max-width: 480px) {
  .dlg-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
  .dlg { width: 100%; }
  .dlg__actions { flex-direction: column-reverse; }
  .dlg__actions .btn { width: 100%; height: var(--h-lg); }
}
</style>
