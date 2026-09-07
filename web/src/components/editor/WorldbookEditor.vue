<script setup lang="ts">
/**
 * 世界書條目編輯。
 *
 * 世界書在上游是獨立實體、可以跨卡複用，所以這裡編的是「這張卡綁著的那一本」，
 * 不是卡的一個欄位。沒綁書時只給一顆建立鈕；建立與綁定都在整份表單儲存時一起做，
 * 因為建立中的卡還沒有 id，綁不上去。
 *
 * 條目預設收合，只露名字、關鍵詞摘要與命中次數：一本六十條的世界書全部攤開是兩萬多像素高，
 * 找一條要捲半天。新加的與匯入後還沒填內容的條目自動展開，作者一眼看到該填什麼。
 *
 * 條目怎麼觸發：關鍵詞命中就把內容送進上下文；寫了次要關鍵詞就要兩邊都出現（AND）；
 * 勾了「常駐」就每輪都送，不看關鍵詞。這三個是上游真的會執行的語意，其餘（插入位置、
 * 掃描深度）上游沒有對應機制，匯入時會列在報告裡而不是偷偷塞進某個欄位。
 *
 * 匹配選項（大小寫、整詞、次要關鍵詞邏輯）只對酒館格式的條目出現。上游看到條目帶
 * matchOptions 就把它切成字面比對，原生條目走的是語意召回——給原生條目開這組選項等於
 * 靜靜換掉它的召回方式，所以這裡只讓已經有這組值的條目改，不提供「轉成酒館匹配」。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchMyWorldbooks, type WorldbookSummary } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { WorldbookEntryDraft } from "@/lib/role-draft";
import { parseWorldbookFile, type DropNote } from "@/lib/tavern";
import WorldbookEntriesDialog from "./WorldbookEntriesDialog.vue";

const props = defineProps<{
  modelValue: WorldbookEntryDraft[];
  /** 已經綁了哪一本。空的代表還沒有，儲存時才會建。 */
  bookName: string;
  bookDesc: string;
  bound: boolean;
  /** 上游那份元資訊讀不到：書名與描述看得到、改不動。改了也送不出去，不讓人白填。 */
  metaLocked: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [WorldbookEntryDraft[]];
  "update:bookName": [string];
  "update:bookDesc": [string];
  create: [];
  /** 從酒館世界書檔（或一張卡）匯入了幾條。沒綁書時由外面順手把書建起來。 */
  imported: [{ name: string; entries: WorldbookEntryDraft[] }];
  /** 挑了自己已經有的一本。條目與綁定由外面處理——條目住在頁面上。 */
  pick: [WorldbookSummary];
  /** 放掉手上這本，回到空狀態重挑。上游的綁定是覆蓋式的，存下去新的就取代舊的。 */
  release: [];
  /** 把這本存成檔案。下載那一步在頁面上，跟角色卡與正則規則共用同一支。 */
  exportBook: [];
}>();

const { t } = useI18n();
const session = useSession();

/** 條目編輯在彈窗裡：一本書幾十條，攤在表單中欄裡找一條要捲半天。 */
const open = ref(false);

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

/**
 * 作者自己已經有的世界書。一本書可以綁給好幾張卡，重建一本一樣的等於之後每張卡各改一次。
 * 拿不到（沒登入、舊版上游）就整塊不出現，不擋建卡。
 */
const mine = ref<WorldbookSummary[]>([]);
const reuseId = ref("");
// 掛載時抓一次，放掉手上那本之後再抓一次——中間可能在別的地方多了幾本
watch(
  () => props.bound,
  async (bound) => {
    if (bound) return;
    reuseId.value = "";
    try {
      const token = await session.accessToken();
      if (!token) return;
      mine.value = await fetchMyWorldbooks(token);
    } catch {
      mine.value = [];
    }
  },
  { immediate: true },
);
function pickExisting() {
  const book = mine.value.find((b) => b.worldbookId === reuseId.value);
  if (book) emit("pick", book);
}

/** 條目摘要：不進彈窗也看得出這本書裡有什麼。 */
const preview = computed(() =>
  props.modelValue
    .map((entry) => entry.name.trim() || entry.keywords[0] || "")
    .filter(Boolean)
    .slice(0, 8),
);
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

    <!-- 已經有的書直接綁過來：同一本可以給好幾張卡用，改一次全部跟著變 -->
    <div v-if="!bound && mine.length" class="field reuse">
      <label for="wb-reuse">{{ $t("wb.reuse") }}</label>
      <div class="reuse__row">
        <select id="wb-reuse" v-model="reuseId" class="input">
          <option value="">{{ $t("wb.reuse.none") }}</option>
          <option v-for="book in mine" :key="book.worldbookId" :value="book.worldbookId">
            {{ $t("wb.reuse.option", { name: book.name, n: book.entryCount }) }}
          </option>
        </select>
        <button type="button" class="btn btn--sm" :disabled="!reuseId" @click="pickExisting">{{ $t("wb.reuse.pick") }}</button>
      </div>
      <span class="subtle">{{ $t("wb.reuse.hint") }}</span>
    </div>

    <template v-else-if="bound">
      <div class="field">
        <label for="wb-name">{{ $t("wb.name") }}</label>
        <div class="reuse__row">
          <input id="wb-name" class="input" :value="bookName" maxlength="60" :readonly="metaLocked"
                 :placeholder="$t('wb.name.placeholder')"
                 @input="emit('update:bookName', ($event.target as HTMLInputElement).value)" />
          <button type="button" class="btn btn--sm btn--ghost" @click="emit('release')">{{ $t("wb.switch") }}</button>
        </div>
        <span v-if="metaLocked" class="subtle">{{ $t("wb.meta.locked") }}</span>
      </div>

      <div v-if="!metaLocked" class="field">
        <label for="wb-desc">{{ $t("wb.desc") }}</label>
        <input id="wb-desc" class="input" :value="bookDesc" maxlength="200"
               :placeholder="$t('wb.desc.placeholder')"
               @input="emit('update:bookDesc', ($event.target as HTMLInputElement).value)" />
        <span class="subtle">{{ $t("wb.desc.hint") }}</span>
      </div>

      <!-- 條目本體在彈窗裡；這裡只留一眼看得完的摘要與入口 -->
      <div class="wb__entries panel">
        <div class="wb__entries-head">
          <span class="subtle">{{ $t("wb.count", { n: modelValue.length }) }}</span>
          <button type="button" class="btn btn--sm btn--primary" @click="open = true">{{ $t("wb.entries.manage") }}</button>
        </div>
        <ul v-if="preview.length" class="wb__names" aria-hidden="true">
          <li v-for="(name, i) in preview" :key="i" class="chip">{{ name }}</li>
          <li v-if="modelValue.length > preview.length" class="subtle wb__more">
            {{ $t("wb.entries.more", { n: modelValue.length - preview.length }) }}
          </li>
        </ul>
        <p v-else class="subtle">{{ $t("wb.entries.empty") }}</p>
      </div>

      <div class="acts">
        <button type="button" class="btn btn--sm btn--ghost" @click="fileInput?.click()">{{ $t("wb.import") }}</button>
        <button type="button" class="btn btn--sm btn--ghost" :disabled="!modelValue.length" @click="emit('exportBook')">{{ $t("wb.export") }}</button>
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

    <WorldbookEntriesDialog v-if="open" :model-value="modelValue"
                            @update:model-value="emit('update:modelValue', $event)" @close="open = false" />
  </section>
</template>

<style scoped>
.empty { display: flex; gap: var(--s-3); align-items: center; justify-content: space-between; padding: var(--s-4); }
.empty .muted { margin: 0; }
.empty__acts, .acts { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.wb > .notice { margin-top: var(--s-3); }
.report { margin: var(--s-1) 0 0; padding-left: 1.1em; display: grid; gap: 2px; font-size: 12.5px; }
.reuse { margin-bottom: var(--s-3); }
.reuse__row { display: flex; gap: var(--s-2); align-items: center; }
.reuse__row .input { flex: 1; min-width: 0; }
.wb__entries { padding: var(--s-3); display: grid; gap: var(--s-2); margin-bottom: var(--s-3); }
.wb__entries-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.wb__names { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wb__more { font-size: 12px; }
</style>
