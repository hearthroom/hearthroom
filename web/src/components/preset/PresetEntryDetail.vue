<script setup lang="ts">
/**
 * 一條自訂條目的內容。由綺夢社提供的條目不在這裡編（編輯器頁另外說明）。
 *
 * 只在玩家需要動手時才出標示：「需調整」附可以接受的調整，「不支援」說明不會執行。
 * 可以直接用的條目什麼都不標（owner 2026-10-29：「部分相容就是相容」）。
 * 這條在酒館還有、但本站不執行的設定只寫一行，匯出時原樣保留；不給看原始 JSON。
 */
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import { whole } from "@/lib/format";
import {
  adaptationId, detachEntry, duplicateEntry, insertEntry, moveEntry, setAdaptation, setEnabled,
  type EntryRow, type PresetDocument, type StPrompt,
} from "@/lib/st-preset";
import type { CompatibilityEntry } from "@/lib/presets";
import { settingLabel } from "./preset-params";

const props = defineProps<{ doc: PresetDocument; row: EntryRow; compat?: CompatibilityEntry; saved?: StPrompt }>();
const emit = defineEmits<{ select: [id: string]; back: []; status: [text: string]; inspect: [] }>();
const { t, te } = useI18n();

const MACROS = ["char", "user", "lastUserMessage"] as const;
const ROLES = ["system", "user", "assistant"] as const;

const prompt = computed(() => props.row.prompt);
const content = ref<HTMLTextAreaElement | null>(null);
const macro = ref<(typeof MACROS)[number]>("char");

const status = computed(() => props.compat?.uiStatus);
const reasonText = (code: string) => te(`preset.reason.entry.${code}`)
  ? t(`preset.reason.entry.${code}`, { role: t(`preset.entry.role.${prompt.value.role === "assistant" ? "assistant" : "user"}`) })
  : "";
const reasons = computed(() => (props.compat?.reasonCodes ?? []).filter((c) => c !== "framework_owned").map(reasonText).filter(Boolean));
const adaptation = computed(() => props.compat?.availableAdaptationIds.find((id) => id === adaptationId(props.row.identifier)));
const accepted = computed(() => !!adaptation.value && props.doc.selection.acceptedAdaptationIds.includes(adaptation.value));
const inert = computed(() => [...new Set((props.compat?.inertSettings ?? []).map((k) => settingLabel(k, t, te)))].join(t("preset.setting.separator")));

const enabled = computed({ get: () => props.row.enabled, set: (on: boolean) => setEnabled(props.doc, props.row.identifier, on) });
const position = computed({
  get: () => (props.row.slot === "D" ? "D" : props.row.side),
  set: (side) => {
    if (side !== "before" && side !== "after") return;
    const on = props.row.enabled;
    prompt.value.injection_position = 0;
    detachEntry(props.doc, props.row.identifier);
    insertEntry(props.doc, props.row.identifier, side === "before" ? "P" : "S");
    setEnabled(props.doc, props.row.identifier, on);
  },
});

function accept() {
  setAdaptation(props.doc, props.row.identifier, true);
  emit("status", t("preset.adapt.moveToSuffix.done"));
}

function insertMacro() {
  const el = content.value;
  const text = prompt.value.content ?? "";
  const token = `{{${macro.value}}}`;
  const at = el ? el.selectionStart : text.length;
  const end = el ? el.selectionEnd : text.length;
  prompt.value.content = text.slice(0, at) + token + text.slice(end);
  void nextTick(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
}

function move(dir: -1 | 1) {
  if (!moveEntry(props.doc, props.row.identifier, dir)) emit("status", t("preset.entry.moveEdge"));
}

function duplicate() {
  const id = duplicateEntry(props.doc, props.row.identifier, t("preset.copy.name.default", { name: prompt.value.name || t("preset.entry.untitled") }));
  if (id) emit("select", id);
}

function detach() {
  detachEntry(props.doc, props.row.identifier);
  emit("status", t("preset.entry.detach.done"));
  emit("back");
}

async function reset() {
  if (!props.saved) { emit("status", t("preset.entry.reset.none")); return; }
  const ok = await confirmDialog({
    title: t("preset.entry.reset"), message: t("preset.entry.reset.body", { name: prompt.value.name || t("preset.entry.untitled") }),
    confirmText: t("preset.entry.reset.confirm"), cancelText: t("preset.entry.reset.keep"), focusCancel: true,
  });
  if (!ok) return;
  const saved = structuredClone(props.saved);
  for (const key of Object.keys(prompt.value)) if (!(key in saved)) delete prompt.value[key];
  Object.assign(prompt.value, saved);
}
</script>

<template>
  <section class="entry" :aria-label="$t('preset.entry.title')">
    <button type="button" class="btn btn--sm btn--ghost entry__back" @click="emit('back')">{{ $t("preset.entry.back") }}</button>

    <div v-if="status" class="entry__notice" :class="`entry__notice--${status}`" role="note" data-testid="entry-status">
      <strong>{{ $t(status === "needs_adjustment" ? "preset.report.status.adjust" : "preset.report.status.unsupported") }}</strong>
      <p v-for="text in reasons" :key="text">{{ text }}</p>
      <template v-if="adaptation">
        <p v-if="accepted">{{ $t("preset.adapt.moveToSuffix.done") }}</p>
        <template v-else>
          <p class="subtle">{{ $t("preset.adapt.moveToSuffix.from") }}<br />{{ $t("preset.adapt.moveToSuffix.to") }}</p>
          <button type="button" class="btn btn--sm entry__accept" data-testid="entry-accept" @click="accept">{{ $t("preset.adapt.moveToSuffix.accept") }}</button>
        </template>
      </template>
    </div>

    <div class="field">
      <label :for="`name-${row.identifier}`">{{ $t("preset.entry.name") }}</label>
      <input :id="`name-${row.identifier}`" v-model="prompt.name" class="input" maxlength="80" />
      <p class="subtle">{{ $t("preset.entry.name.hint") }}</p>
    </div>
    <div class="entry__row">
      <div class="field">
        <label :for="`pos-${row.identifier}`">{{ $t("preset.entry.position") }}</label>
        <select :id="`pos-${row.identifier}`" v-model="position" class="input">
          <option value="before">{{ $t("preset.entry.position.before") }}</option>
          <option value="after">{{ $t("preset.entry.position.after") }}</option>
          <option v-if="row.slot === 'D'" value="D" disabled>{{ $t("preset.entry.position.middle") }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="`role-${row.identifier}`">{{ $t("preset.entry.role") }}</label>
        <select :id="`role-${row.identifier}`" v-model="prompt.role" class="input">
          <option v-for="r in ROLES" :key="r" :value="r">{{ $t(`preset.entry.role.${r}`) }}</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label :for="`content-${row.identifier}`">{{ $t("preset.entry.content") }}</label>
      <textarea :id="`content-${row.identifier}`" ref="content" v-model="prompt.content" class="input entry__content" spellcheck="false" autocomplete="off" />
      <div class="field__foot">
        <div class="entry__macro">
          <label class="sr-only" :for="`macro-${row.identifier}`">{{ $t("preset.entry.macro") }}</label>
          <select :id="`macro-${row.identifier}`" v-model="macro" class="input entry__macroPick">
            <option v-for="m in MACROS" :key="m" :value="m">{{ $t(`preset.entry.macro.${m}`) }}</option>
          </select>
          <button type="button" class="btn btn--sm" @click="insertMacro">{{ $t("preset.entry.macro.insert") }}</button>
        </div>
        <span class="subtle">{{ $t("preset.entry.count", { n: whole((prompt.content ?? "").length) }) }}</span>
      </div>
      <p v-if="macro === 'lastUserMessage'" class="subtle">{{ $t("preset.entry.macro.lastUserMessage.hint") }}</p>
    </div>
    <p v-if="inert" class="subtle" data-testid="entry-inert">{{ $t("preset.entry.inert", { settings: inert }) }}</p>
    <details v-if="row.side === 'after'" class="entry__diff">
      <summary>{{ $t("preset.entry.diff.summary") }}</summary>
      <p class="subtle">{{ $t("preset.entry.diff.suffix") }}</p>
    </details>

    <label class="entry__check">
      <input v-model="enabled" type="checkbox" />
      <span>{{ $t("preset.entry.enabled") }}</span>
    </label>
    <div class="entry__actions">
      <button type="button" class="btn btn--sm" @click="move(-1)">{{ $t("preset.entry.moveUp") }}</button>
      <button type="button" class="btn btn--sm" @click="move(1)">{{ $t("preset.entry.moveDown") }}</button>
      <button type="button" class="btn btn--sm" @click="emit('inspect')">{{ $t("preset.entry.inspect") }}</button>
      <button type="button" class="btn btn--sm" @click="duplicate">{{ $t("preset.entry.duplicate") }}</button>
      <button type="button" class="btn btn--sm btn--ghost" @click="reset">{{ $t("preset.entry.reset") }}</button>
      <button type="button" class="btn btn--sm btn--ghost" data-testid="entry-detach" @click="detach">{{ $t("preset.entry.detach") }}</button>
    </div>
  </section>
</template>

<style scoped>
.entry { display: grid; gap: var(--s-3); align-content: start; }
.entry__back { display: none; justify-self: start; }
.entry .field { margin-bottom: 0; }
.entry .field > p { margin: 0; }
.entry__row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); }
.entry__content { min-height: 220px; font-size: 14px; }
.entry__macro { display: flex; align-items: center; gap: var(--s-2); }
.entry__macroPick { width: auto; height: var(--h-sm); font-size: 13px; }
.entry__check { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); cursor: pointer; }
.entry__check input { width: 18px; height: 18px; accent-color: var(--accent); }
.entry__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.entry__notice { border-radius: var(--r-md); padding: var(--s-3) var(--s-4); display: grid; gap: var(--s-2); background: var(--surface-2); }
.entry__notice p { margin: 0; font-size: 13px; color: var(--text-2); }
.entry__notice--needs_adjustment strong { color: var(--warning-text); }
.entry__notice--unsupported strong { color: var(--danger); }
.entry__accept { justify-self: start; height: auto; min-height: var(--h-sm); white-space: normal; }
.entry__diff summary { cursor: pointer; font-size: 13px; color: var(--text-2); min-height: var(--h-sm); display: flex; align-items: center; }
.entry__diff p { margin: var(--s-1) 0 0; }
.entry p { overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .entry__back { display: inline-flex; }
  .entry__row { grid-template-columns: 1fr; }
}
</style>
