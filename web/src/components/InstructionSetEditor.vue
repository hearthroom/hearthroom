<script setup lang="ts">
/**
 * 新增或編輯一組長期指令：桌機 420 modal，手機從底部拉起的 sheet（ui.md §5 B4）。
 *
 * 名稱＋條目清單（每條一個多行輸入，可刪可加）。上限由伺服器回傳。輸入檢查與伺服器同一套規則，
 * 伺服器的錯誤只是後備：單條的錯誤照 detail.index 放回那一條底下。儲存失敗留在這裡、輸入不清。
 * 沒儲存就關（Esc、點遮罩、取消）要先確認放棄；確認框開著時這裡的鍵盤處理讓開，不跟它搶 Esc 與 Tab。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import { wrapTab } from "@/lib/focus-trap";
import { whole } from "@/lib/format";
import {
  InstructionSetError, charCount, checkInstructionSet, deleteConsequence, deleteInstructionSet, itemProblemOfCode, saveInstructionSet,
  type InstructionLimits, type InstructionSet, type ItemProblem,
} from "@/lib/instruction-sets";

const props = defineProps<{ set: InstructionSet | null; limits: InstructionLimits; token: () => Promise<string> }>();
const emit = defineEmits<{ close: []; saved: [set: InstructionSet]; deleted: [set: InstructionSet]; stale: [] }>();
const { t } = useI18n();

let seq = 0;
const row = (text: string) => ({ id: ++seq, text, touched: false });
const name = ref(props.set?.title ?? "");
const nameTouched = ref(false);
const rows = reactive((props.set?.items.length ? props.set.items : [""]).map(row));
const snapshot = JSON.stringify({ title: name.value, items: rows.map((r) => r.text) });
/** 伺服器退回的單條原因（index → 原因）；那一條一改就拿掉，改完由前端檢查接手。 */
const serverItem = reactive(new Map<number, ItemProblem>());
const error = ref("");
const busy = ref<"" | "save" | "delete">("");
const box = ref<HTMLElement | null>(null);
const titleId = `instruction-set-${Math.random().toString(36).slice(2)}`;
let confirming = false;

const check = computed(() => checkInstructionSet(name.value, rows.map((r) => r.text), props.limits));
const dirty = computed(() => JSON.stringify({ title: name.value, items: rows.map((r) => r.text) }) !== snapshot);
const canSave = computed(() => check.value.ok && !busy.value && (dirty.value || !props.set));

function itemError(i: number): string {
  const r = rows[i]!;
  const problem = serverItem.get(r.id) ?? check.value.items[i];
  // 空白的那一條在碰過之前不叫：剛按「新增一條」就說「不能空白」只是噪音（儲存鍵已經停用）
  if (!problem || (problem === "empty" && !r.touched && !serverItem.has(r.id))) return "";
  return problem === "empty" ? t("instructions.item.empty") : problem === "tooLong" ? t("instructions.item.tooLong", { max: whole(props.limits.maxLength) }) : t("instructions.item.chars");
}
const nameError = computed(() => {
  const p = check.value.title;
  if (p === "tooLong") return t("instructions.name.tooLong", { max: whole(props.limits.maxTitle) });
  return p === "empty" && nameTouched.value ? t("instructions.name.empty") : "";
});

function edit(i: number, value: string) {
  const r = rows[i]!;
  r.text = value;
  r.touched = true;
  serverItem.delete(r.id);
}

async function addRow() {
  if (rows.length >= props.limits.maxItems) return;
  rows.push(row(""));
  await nextTick();
  box.value?.querySelector<HTMLTextAreaElement>(".iset__item:last-of-type textarea")?.focus();
}

function removeRow(i: number) {
  if (rows.length <= 1) return;
  const [gone] = rows.splice(i, 1);
  if (gone) serverItem.delete(gone.id);
}

async function ask(options: Parameters<typeof confirmDialog>[0]): Promise<boolean> {
  confirming = true;
  try { return await confirmDialog(options); } finally { confirming = false; }
}

async function requestClose() {
  if (busy.value || confirming) return;
  if (dirty.value && !(await ask({
    title: t("instructions.discard.title"), message: t("instructions.discard.body"),
    confirmText: t("instructions.discard.confirm"), cancelText: t("instructions.discard.keep"), danger: true, focusCancel: true,
  }))) return;
  emit("close");
}

async function save() {
  nameTouched.value = true;
  rows.forEach((r) => { r.touched = true; });
  if (!canSave.value) return;
  busy.value = "save";
  error.value = "";
  try {
    const saved = await saveInstructionSet(await props.token(), { presetId: props.set?.presetId, title: name.value, items: rows.map((r) => r.text) });
    emit("saved", saved);
  } catch (err) {
    const code = err instanceof InstructionSetError ? err.code : "";
    const problem = itemProblemOfCode(code);
    const target = err instanceof InstructionSetError && err.index !== undefined ? rows[err.index] : undefined;
    if (problem && target) serverItem.set(target.id, problem);
    else if (code === "DIRECTIVE_PRESET_LIMIT_REACHED") error.value = t("instructions.limit", { max: whole(props.limits.maxCount) });
    else error.value = t("instructions.error.save");
    // 這一組在別處被刪了：列表重新讀，這裡的輸入照樣留著
    if (code === "DIRECTIVE_PRESET_NOT_FOUND") emit("stale");
  } finally {
    busy.value = "";
  }
}

async function remove() {
  const set = props.set;
  if (!set || busy.value || confirming) return;
  const consequence = deleteConsequence(set.cardCount);
  const ok = await ask({
    title: t("instructions.delete.title", { name: set.title }),
    message: t(consequence.key, { n: whole(consequence.n) }, consequence.n),
    confirmText: t("instructions.delete.confirm"), cancelText: t("instructions.delete.keep"), danger: true, focusCancel: true,
  });
  if (!ok) return;
  busy.value = "delete";
  error.value = "";
  try {
    await deleteInstructionSet(await props.token(), set.presetId);
    emit("deleted", set);
  } catch (err) {
    // 已經不在了＝要的結果已經達成
    if (err instanceof InstructionSetError && err.code === "DIRECTIVE_PRESET_NOT_FOUND") emit("deleted", set);
    else error.value = err instanceof Error && err.message ? err.message : t("instructions.error.save");
  } finally {
    busy.value = "";
  }
}

let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (confirming) return;
  if (e.key === "Escape") { e.preventDefault(); void requestClose(); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLInputElement>("input")?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop iset-backdrop" @click.self="requestClose">
      <div ref="box" class="modal panel iset" role="dialog" aria-modal="true" :aria-labelledby="titleId" data-testid="instruction-editor">
        <h2 :id="titleId" class="modal__title">{{ $t(set ? "instructions.edit.title" : "instructions.new") }}</h2>

        <div class="field">
          <label :for="`${titleId}-name`">{{ $t("instructions.name.label") }}</label>
          <input
            :id="`${titleId}-name`" v-model="name" class="input" autocomplete="off" data-testid="instruction-name"
            :aria-invalid="!!nameError || undefined" :aria-describedby="`${titleId}-name-foot`" @blur="nameTouched = true"
          />
          <div :id="`${titleId}-name-foot`" class="iset__foot">
            <span class="iset__error" aria-live="polite">{{ nameError }}</span>
            <span class="iset__count" :class="{ 'is-over': charCount(name.trim()) > limits.maxTitle }">{{ charCount(name.trim()) }} / {{ limits.maxTitle }}</span>
          </div>
        </div>

        <fieldset class="field iset__items">
          <legend>{{ $t("instructions.items.label") }} <span class="subtle">({{ rows.length }}/{{ limits.maxItems }})</span></legend>
          <div v-for="(r, i) in rows" :key="r.id" class="iset__item" data-testid="instruction-item">
            <div class="iset__itemRow">
              <textarea
                :id="`${titleId}-item-${r.id}`" class="input" rows="2" autocomplete="off" :value="r.text" :aria-label="`${$t('instructions.items.label')} ${i + 1}`"
                :aria-invalid="!!itemError(i) || undefined" :aria-describedby="`${titleId}-item-${r.id}-foot`"
                @input="edit(i, ($event.target as HTMLTextAreaElement).value)" @blur="r.touched = true"
              />
              <button
                type="button" class="btn btn--ghost btn--icon iset__remove" :aria-label="$t('instructions.item.remove')"
                :disabled="rows.length <= 1" data-testid="instruction-item-remove" @click="removeRow(i)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <div :id="`${titleId}-item-${r.id}-foot`" class="iset__foot">
              <span class="iset__error" aria-live="polite" data-testid="instruction-item-error">{{ itemError(i) }}</span>
              <span class="iset__count" :class="{ 'is-over': charCount(r.text.trim()) > limits.maxLength }">{{ charCount(r.text.trim()) }} / {{ limits.maxLength }}</span>
            </div>
          </div>
          <button type="button" class="btn btn--sm iset__add" :disabled="rows.length >= limits.maxItems" data-testid="instruction-item-add" @click="addRow">{{ $t("instructions.item.add") }}</button>
        </fieldset>

        <p v-if="error" class="notice notice--error" role="alert" data-testid="instruction-error">{{ error }}</p>

        <div class="iset__actions">
          <button v-if="set" type="button" class="btn btn--ghost iset__delete" :disabled="!!busy" data-testid="instruction-delete" @click="remove">{{ $t("instructions.delete.action") }}</button>
          <div class="iset__main">
            <button type="button" class="btn" :disabled="!!busy" @click="requestClose">{{ $t("instructions.cancel") }}</button>
            <button type="button" class="btn btn--primary iset__save" :disabled="!canSave" :aria-busy="busy === 'save' || undefined" data-testid="instruction-save" @click="save">
              <span :class="{ 'iset__hidden': busy === 'save' }">{{ $t("instructions.save") }}</span>
              <span v-if="busy === 'save'" class="iset__spin" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.iset { gap: var(--s-4); }
.iset .field { display: grid; gap: var(--s-1); margin: 0; }
.iset .field > label, .iset legend { font-size: 13px; font-weight: 600; }
.iset__items { border: 0; padding: 0; min-width: 0; gap: var(--s-2); }
.iset__items legend { padding: 0; margin-bottom: var(--s-1); }
.iset__items legend .subtle { font-weight: 400; }
.iset__item { display: grid; gap: 2px; }
.iset__itemRow { display: flex; align-items: flex-start; gap: var(--s-1); }
.iset__itemRow textarea.input { flex: 1; min-width: 0; min-height: 64px; overflow-wrap: anywhere; }
.iset__remove { flex-shrink: 0; color: var(--text-3); }
.iset__foot { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); font-size: 12px; min-height: 18px; }
.iset__error { color: var(--danger); }
.iset__count { margin-left: auto; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.iset__count.is-over { color: var(--danger); }
.iset__add { justify-self: start; }
.iset__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); margin-top: var(--s-1); }
.iset__main { display: flex; gap: var(--s-2); margin-left: auto; }
.iset__delete { color: var(--danger); }
.iset__save { position: relative; }
.iset__hidden { visibility: hidden; }
.iset__spin { position: absolute; inset: 0; margin: auto; width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: iset-spin .8s linear infinite; }
@keyframes iset-spin { to { transform: rotate(360deg); } }
:lang(ko) .iset { word-break: keep-all; }
/* 手機：貼底的 sheet，頂角 24、底部留 safe-area；按鈕直排全寬，主行動在最上面 */
@media (max-width: 480px) {
  .iset-backdrop { padding: 0; }
  .iset { width: 100%; max-height: 92dvh; border-radius: 24px 24px 0 0; padding-bottom: calc(var(--s-4) + env(safe-area-inset-bottom)); }
  .iset__actions { flex-direction: column-reverse; align-items: stretch; }
  .iset__main { flex-direction: column-reverse; margin-left: 0; }
  .iset__actions .btn { width: 100%; height: var(--h-lg); }
}
</style>
