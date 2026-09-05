<script setup lang="ts">
/**
 * 世界書條目編輯。
 *
 * 世界書在上游是獨立實體、可以跨卡複用，所以這裡編的是「這張卡綁著的那一本」，
 * 不是卡的一個欄位。沒綁書時只給一顆建立鈕；建立與綁定都在整份表單儲存時一起做，
 * 因為建立中的卡還沒有 id，綁不上去。
 *
 * 條目怎麼觸發：關鍵詞命中就把內容送進上下文；寫了次要關鍵詞就要兩邊都出現（AND）；
 * 勾了「常駐」就每輪都送，不看關鍵詞。這三個是上游真的會執行的語意，其餘（插入位置、
 * 掃描深度）上游沒有對應機制，匯入時會列在報告裡而不是偷偷塞進某個欄位。
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import type { WorldbookEntryDraft } from "@/lib/role-draft";
import { parseWorldbookFile, type DropNote } from "@/lib/tavern";

const props = defineProps<{
  modelValue: WorldbookEntryDraft[];
  /** 已經綁了哪一本。空的代表還沒有，儲存時才會建。 */
  bookName: string;
  bound: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [WorldbookEntryDraft[]];
  "update:bookName": [string];
  create: [];
  /** 從酒館世界書檔（或一張卡）匯入了幾條。沒綁書時由外面順手把書建起來。 */
  imported: [{ name: string; entries: WorldbookEntryDraft[] }];
}>();

const { t } = useI18n();

const NAME_MAX = 20;

const commit = (next: WorldbookEntryDraft[]) => emit("update:modelValue", next);

function patch(index: number, changes: Partial<WorldbookEntryDraft>) {
  const next = props.modelValue.slice();
  next[index] = { ...next[index], ...changes };
  commit(next);
}

const add = () =>
  commit([...props.modelValue, { name: "", content: "", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false }]);

async function remove(index: number) {
  const entry = props.modelValue[index];
  // 已經在上游存在的條目，刪掉是真的會消失；還沒存過的只是移出這份草稿，不必問。
  if (entry.entryId && !(await confirmDialog({ message: t("wb.entry.deleteConfirm"), confirmText: t("wb.entry.delete"), danger: true }))) return;
  commit(props.modelValue.filter((_, i) => i !== index));
}

/**
 * 匯入酒館的世界書檔。條目接在現有條目後面，不覆蓋——作者可能已經手寫了幾條，
 * 而世界書本來就是可以一本一本併起來的東西。丟掉的欄位跟卡片匯入一樣列出來。
 */
const fileInput = ref<HTMLInputElement | null>(null);
const importError = ref("");
const importReport = ref<DropNote[]>([]);
const importedCount = ref(0);
const IMPORT_ERRORS: Record<string, string> = {
  tavern_invalid: "import.error.invalid",
  tavern_no_metadata: "import.error.noMetadata",
  worldbook_invalid: "wb.import.error",
};
async function onImportFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file) return;
  importError.value = "";
  importReport.value = [];
  importedCount.value = 0;
  try {
    const parsed = await parseWorldbookFile(file);
    if (!parsed.entries.length) throw new Error("worldbook_invalid");
    // 空條目（按了「加一條」還沒填的）讓位給匯入的，不然會夾一格空的在中間
    const kept = props.modelValue.filter((e) => e.content.trim() || e.entryId);
    const entries = [...kept, ...parsed.entries];
    emit("imported", { name: parsed.name, entries });
    importedCount.value = parsed.entries.length;
    importReport.value = parsed.dropped;
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    importError.value = t(IMPORT_ERRORS[code] ?? "wb.import.error");
  }
}

const splitKeywords = (raw: string) => raw.split(/[、,，]+/).map((k) => k.trim()).filter(Boolean);
const keywordsText = (entry: WorldbookEntryDraft) => entry.keywords.join("、");
const setKeywords = (index: number, raw: string) => patch(index, { keywords: splitKeywords(raw) });
const secondaryText = (entry: WorldbookEntryDraft) => (entry.secondaryKeywords ?? []).join("、");
const setSecondary = (index: number, raw: string) => patch(index, { secondaryKeywords: splitKeywords(raw) });
</script>

<template>
  <section class="wb">
    <div v-if="!bound" class="empty panel">
      <p class="muted">{{ $t("wb.empty") }}</p>
      <div class="empty__acts">
        <button type="button" class="btn btn--sm" @click="emit('create')">{{ $t("wb.create") }}</button>
        <button type="button" class="btn btn--sm btn--ghost" @click="fileInput?.click()">{{ $t("wb.import") }}</button>
      </div>
    </div>

    <template v-else>
      <div class="field">
        <label for="wb-name">{{ $t("wb.name") }}</label>
        <input id="wb-name" class="input" :value="bookName" maxlength="60"
               :placeholder="$t('wb.name.placeholder')"
               @input="emit('update:bookName', ($event.target as HTMLInputElement).value)" />
      </div>

      <p class="subtle count">{{ $t("wb.count", { n: modelValue.length }) }}</p>

      <ul class="entries">
        <li v-for="(entry, index) in modelValue" :key="entry.entryId ?? `new-${index}`" class="entry panel">
          <div class="entry__head">
            <input class="input input--name" :value="entry.name" :maxlength="NAME_MAX"
                   :placeholder="$t('wb.entry.name.placeholder')" :aria-label="$t('wb.entry.name')"
                   @input="patch(index, { name: ($event.target as HTMLInputElement).value })" />
            <!-- 上游統計：這條被帶進對話幾次。作者看哪些條目真的在用、哪些從沒觸發 -->
            <span v-if="typeof entry.activationCount === 'number'" class="chip hits" :title="$t('wb.entry.activations', { n: entry.activationCount })">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" />
              </svg>
              <span class="sr-only">{{ $t("wb.entry.activations", { n: entry.activationCount }) }}</span>
              <span aria-hidden="true">{{ entry.activationCount }}</span>
            </span>
            <button type="button" class="btn btn--icon btn--sm btn--danger" :aria-label="$t('wb.entry.delete')"
                    :title="$t('wb.entry.delete')" @click="remove(index)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
              </svg>
            </button>
          </div>

          <div class="field">
            <label :for="`wb-kw-${index}`">{{ $t("wb.entry.keywords") }}</label>
            <input :id="`wb-kw-${index}`" class="input" :value="keywordsText(entry)"
                   :placeholder="$t('wb.entry.keywords.placeholder')" :disabled="entry.isConstant"
                   @input="setKeywords(index, ($event.target as HTMLInputElement).value)" />
            <span class="subtle">{{ entry.isConstant ? $t("wb.entry.keywords.constantHint") : $t("wb.entry.keywords.hint") }}</span>
          </div>

          <div v-if="!entry.isConstant" class="field">
            <label :for="`wb-sk-${index}`">{{ $t("wb.entry.secondary") }}</label>
            <input :id="`wb-sk-${index}`" class="input" :value="secondaryText(entry)"
                   :placeholder="$t('wb.entry.secondary.placeholder')"
                   @input="setSecondary(index, ($event.target as HTMLInputElement).value)" />
            <span class="subtle">{{ $t("wb.entry.secondary.hint") }}</span>
          </div>

          <div class="field">
            <label :for="`wb-c-${index}`">{{ $t("wb.entry.content") }}</label>
            <textarea :id="`wb-c-${index}`" class="input" rows="4" :value="entry.content"
                      :placeholder="$t('wb.entry.content.placeholder')"
                      @input="patch(index, { content: ($event.target as HTMLTextAreaElement).value })" />
          </div>

          <div class="toggles">
            <label class="toggle">
              <input type="checkbox" :checked="entry.isEnabled"
                     @change="patch(index, { isEnabled: ($event.target as HTMLInputElement).checked })" />
              <span>{{ $t("wb.entry.enabled") }}</span>
            </label>
            <label class="toggle">
              <input type="checkbox" :checked="entry.isConstant"
                     @change="patch(index, { isConstant: ($event.target as HTMLInputElement).checked })" />
              <span>{{ $t("wb.entry.constant") }}</span>
            </label>
          </div>
        </li>
      </ul>

      <div class="acts">
        <button type="button" class="btn btn--sm" @click="add">{{ $t("wb.entry.add") }}</button>
        <button type="button" class="btn btn--sm btn--ghost" @click="fileInput?.click()">{{ $t("wb.import") }}</button>
      </div>
    </template>

    <input ref="fileInput" type="file" accept=".png,.json,image/png,application/json" class="sr-only" @change="onImportFile" />
    <p v-if="importError" class="notice notice--error" role="alert">{{ importError }}</p>
    <div v-else-if="importedCount" class="notice" role="status">
      {{ $t("wb.import.done", { n: importedCount }) }}
      <ul v-if="importReport.length" class="report">
        <li v-for="(note, i) in importReport" :key="i">{{ $t(note.key, note.params ?? {}) }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.empty { display: flex; gap: var(--s-3); align-items: center; justify-content: space-between; padding: var(--s-4); }
.empty .muted { margin: 0; }
.empty__acts, .acts { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.wb > .notice { margin-top: var(--s-3); }
.report { margin: var(--s-1) 0 0; padding-left: 1.1em; display: grid; gap: 2px; font-size: 12.5px; }
.count { display: block; margin: 0 0 var(--s-2); }
.entries { list-style: none; margin: 0 0 var(--s-3); padding: 0; display: grid; gap: var(--s-3); }
.entry { padding: var(--s-3); display: grid; gap: var(--s-3); }
.entry__head { display: flex; gap: var(--s-2); align-items: center; }
.input--name { flex: 1; font-weight: 600; }
.hits { cursor: default; gap: 4px; font-variant-numeric: tabular-nums; }
.toggles { display: flex; gap: var(--s-4); flex-wrap: wrap; }
.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }
</style>
