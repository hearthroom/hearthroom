<script setup lang="ts">
/**
 * 世界書條目編輯。
 *
 * 世界書在上游是獨立實體、可以跨卡複用，所以這裡編的是「這張卡綁著的那一本」，
 * 不是卡的一個欄位。沒綁書時只給一顆建立鈕；建立與綁定都在整份表單儲存時一起做，
 * 因為建立中的卡還沒有 id，綁不上去。
 *
 * 條目怎麼觸發：關鍵詞命中就把內容送進上下文；勾了「常駐」就每輪都送，不看關鍵詞。
 * 這兩個是上游真的會執行的語意，其餘（酒館卡的次要關鍵詞、插入位置、掃描深度）
 * 上游沒有對應機制，匯入時會列在報告裡而不是偷偷塞進某個欄位。
 */
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import type { WorldbookEntryDraft } from "@/lib/role-draft";

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
  commit([...props.modelValue, { name: "", content: "", keywords: [], isEnabled: true, isConstant: false }]);

async function remove(index: number) {
  const entry = props.modelValue[index];
  // 已經在上游存在的條目，刪掉是真的會消失；還沒存過的只是移出這份草稿，不必問。
  if (entry.entryId && !(await confirmDialog({ message: t("wb.entry.deleteConfirm"), confirmText: t("wb.entry.delete"), danger: true }))) return;
  commit(props.modelValue.filter((_, i) => i !== index));
}

const keywordsText = (entry: WorldbookEntryDraft) => entry.keywords.join("、");
const setKeywords = (index: number, raw: string) =>
  patch(index, { keywords: raw.split(/[、,，]+/).map((k) => k.trim()).filter(Boolean) });
</script>

<template>
  <section class="wb">
    <div v-if="!bound" class="empty panel">
      <p class="muted">{{ $t("wb.empty") }}</p>
      <button type="button" class="btn btn--sm" @click="emit('create')">{{ $t("wb.create") }}</button>
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

      <button type="button" class="btn btn--sm" @click="add">{{ $t("wb.entry.add") }}</button>
    </template>
  </section>
</template>

<style scoped>
.empty { display: flex; gap: var(--s-3); align-items: center; justify-content: space-between; padding: var(--s-4); }
.empty .muted { margin: 0; }
.count { display: block; margin: 0 0 var(--s-2); }
.entries { list-style: none; margin: 0 0 var(--s-3); padding: 0; display: grid; gap: var(--s-3); }
.entry { padding: var(--s-3); display: grid; gap: var(--s-3); }
.entry__head { display: flex; gap: var(--s-2); align-items: center; }
.input--name { flex: 1; font-weight: 600; }
.toggles { display: flex; gap: var(--s-4); flex-wrap: wrap; }
.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }
</style>
