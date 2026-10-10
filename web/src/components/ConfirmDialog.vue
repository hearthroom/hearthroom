<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { confirmDialog, confirmState, confirmTextMatches, settleConfirm } from "@/lib/confirm";
import LookupField, { type LookupValue } from "./LookupField.vue";

const box = ref<HTMLElement | null>(null);
/** 要照打的字：每次開新彈窗清空 */
const typed = ref("");
/** 選填的那一格：開新彈窗時填上預設值；有 lookup 的那種還帶著對上的編號 */
const fieldText = ref("");
const fieldPick = ref<LookupValue>({ label: "" });
const typedOk = computed(() => !!confirmState.current && confirmTextMatches(confirmState.current, typed.value));
function confirm() {
  const cur = confirmState.current;
  if (!cur || !typedOk.value) return;
  if (cur.field?.lookup) settleConfirm(true, typed.value, fieldPick.value.label, fieldPick.value.id);
  else settleConfirm(true, typed.value, fieldText.value);
}
/** 開啟前的焦點：關掉時還回去，鍵盤使用者不會掉到頁面開頭 */
let restore: HTMLElement | null = null;

watch(() => confirmState.current, async (cur) => {
  if (!cur) { restore?.focus?.(); restore = null; return; }
  restore = document.activeElement as HTMLElement | null;
  typed.value = "";
  fieldText.value = cur.field?.initial ?? "";
  fieldPick.value = { label: cur.field?.initial ?? "", ...(cur.field?.initialId ? { id: cur.field.initialId } : {}) };
  await nextTick();
  // 要照打的字：焦點直接進打字框。其他破壞性動作先站在取消鍵上：按錯 Enter 也不會刪掉東西
  const pick = cur.requireText ? "[data-typed]" : cur.danger && !cur.single ? "[data-cancel]" : "[data-confirm]";
  box.value?.querySelector<HTMLElement>(pick)?.focus();
});

function onKey(e: KeyboardEvent) {
  if (!confirmState.current) return;
  if (e.key === "Escape") { e.preventDefault(); settleConfirm(false); return; }
  // 焦點只在彈窗裡繞
  if (e.key === "Tab" && box.value) {
    const items = [...box.value.querySelectorAll<HTMLElement>("button, input, [tabindex='0']")];
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
        <!-- 要照打的字：打對了確認鍵才亮；Enter 也只在打對時算數 -->
        <label v-if="confirmState.current.requireText" class="dlg__typed">
          <span class="dlg__typed-hint">{{ $t("dialog.typeToConfirm", { text: confirmState.current.requireText }) }}</span>
          <input v-model="typed" class="input" type="text" autocomplete="off" spellcheck="false" data-typed
                 :placeholder="confirmState.current.placeholder ?? confirmState.current.requireText"
                 @keydown.enter.prevent="confirm" />
        </label>
        <!-- 選填的一格字（例如原作）：Enter 不送出，送出仍要按確認鍵 -->
        <label v-if="confirmState.current.field" class="dlg__field">
          <span class="dlg__field-label">{{ confirmState.current.field.label }}</span>
          <LookupField v-if="confirmState.current.field.lookup" v-model="fieldPick" :lookup="confirmState.current.field.lookup" :placeholder="confirmState.current.field.placeholder" :maxlength="confirmState.current.field.maxlength" :label="confirmState.current.field.label" />
          <input v-else v-model="fieldText" class="input" type="text" autocomplete="off" data-field
                 :placeholder="confirmState.current.field.placeholder" :maxlength="confirmState.current.field.maxlength" @keydown.enter.prevent="confirm" />
          <span v-if="confirmState.current.field.hint" class="subtle">{{ confirmState.current.field.hint }}</span>
        </label>
        <div class="dlg__actions">
          <button v-if="!confirmState.current.single" class="btn" data-cancel @click="settleConfirm(false)">
            {{ confirmState.current.cancelText ?? $t("dialog.cancel") }}
          </button>
          <button class="btn" :class="confirmState.current.danger ? 'btn--danger-solid' : 'btn--primary'" data-confirm
                  :disabled="!typedOk" @click="confirm">
            {{ confirmState.current.confirmText ?? $t("dialog.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 110 而不是 100：確認框是從別的全頁浮層（世界書條目、正則規則、素材庫，都是 100）裡叫出來的。
   同為 100 時誰後掛到 body 誰在上，而這個元件掛在 App 一開始，永遠輸給後開的浮層。 */
.dlg-backdrop {
  position: fixed; inset: 0; z-index: 110;
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
.dlg__typed { display: grid; gap: 6px; }
.dlg__typed-hint { font-size: 12.5px; color: var(--text-3); }
.dlg__typed .input { width: 100%; }
.dlg__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }

@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

@media (max-width: 480px) {
  .dlg-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
  .dlg { width: 100%; }
  .dlg__actions { flex-direction: column-reverse; }
  .dlg__actions .btn { width: 100%; height: var(--h-lg); }
}
.dlg__field { display: grid; gap: 6px; text-align: left; }
.dlg__field-label { font-size: 13px; color: var(--text-2); }
</style>
