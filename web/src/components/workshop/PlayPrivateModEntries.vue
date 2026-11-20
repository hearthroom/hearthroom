<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { entryContentMax } from "@/lib/tavern";
import { CONSTANT_CHAR_LIMIT, fetchPrivateMod, savePrivateMod } from "@/lib/workshop";
import type { ModAction, PrivateModBook, PrivateModEntry } from "@/lib/workshop-mods";

const props = defineProps<{
  conversationId?: string;
  shown: boolean;
  auth: () => Promise<string>;
  changeEntry?: (action: ModAction, row: string, version?: string) => Promise<boolean>;
  universal?: {
    load: () => Promise<PrivateModBook>;
    save: (revision: string, entries: PrivateModEntry[]) => Promise<PrivateModBook>;
  };
  version?: string;
  settingsBusy: boolean;
}>();
const emit = defineEmits<{ back: []; close: []; saved: [] }>();
const { t, n } = useI18n();
const tr = (key: string, params: Record<string, string | number> = {}) => t("workshop.mineEntries." + key, params);
const windowText = (key: string) => t("workshop.window." + key);
const book = shallowRef<PrivateModBook>();
const loading = ref(false);
const loadFailed = ref(false);
const editing = ref(false);
const draft = ref<PrivateModEntry>();
const keyword = ref("");
const confirmDelete = ref(false);
const busy = ref(false);
const saveFailed = ref(false);
const failedToggle = ref("");
const formTried = ref(false);
const cancelDelete = ref<HTMLButtonElement | null>(null);
const back = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLElement | null>(null);
let listScroll = 0;
let readSequence = 0;

const chars = (s: string) => Array.from(s.trim()).length;
const maxEntryChars = computed(() => book.value?.entryContentMax ?? entryContentMax());
const editedExisting = computed(() => book.value?.entries.some(entry => entry.id === draft.value?.id));
const draftKeywords = computed(() => {
  const words = draft.value?.keywords ?? [];
  const pending = keyword.value.trim();
  return pending && !words.includes(pending) ? [...words, pending] : words;
});
const nextResidentChars = computed(() => {
  const claim = book.value?.entries.filter(entry => entry.id !== draft.value?.id && (entry.resident ?? !entry.keywords.length))
    .reduce((total, entry) => total + chars(entry.content), 0) ?? 0;
  const existing = book.value?.entries.find((entry) => entry.id === draft.value?.id);
  const unchangedKeywords = existing?.keywords.length === draftKeywords.value.length &&
    existing.keywords.every((word, index) => word === draftKeywords.value[index]);
  const resident = unchangedKeywords ? (existing.resident ?? !draftKeywords.value.length) : !draftKeywords.value.length;
  return claim + (draft.value && resident ? chars(draft.value.content) : 0);
});
const title = computed(() => props.universal && !editing.value
  ? t("workshop.editor.section.world")
  : tr(editing.value ? (editedExisting.value ? "form.editTitle" : "form.newTitle") : "title"));

async function load() {
  const sequence = ++readSequence;
  loading.value = true;
  loadFailed.value = false;
  try {
    const next = props.universal ? await props.universal.load() : await fetchPrivateMod(props.conversationId ?? "", await props.auth());
    if (sequence === readSequence) book.value = next;
  } catch {
    if (sequence === readSequence) loadFailed.value = true;
  } finally {
    if (sequence === readSequence) loading.value = false;
  }
}
watch(() => props.shown, shown => { if (shown) void load(); }, { immediate: true });

function entryName(entry: PrivateModEntry) {
  return entry.name || Array.from(entry.content).slice(0, 20).join("");
}
function enter(entry?: PrivateModEntry) {
  if ((!entry && editedExisting.value) || (entry && draft.value?.id !== entry.id)) {
    draft.value = undefined;
    keyword.value = "";
  }
  draft.value ??= entry
    ? { id: entry.id, name: entry.name, keywords: [...entry.keywords], content: entry.content }
    : { id: crypto.randomUUID(), name: "", keywords: [], content: "" };
  listScroll = list.value?.scrollTop ?? 0;
  editing.value = true;
  confirmDelete.value = false;
  formTried.value = false;
  saveFailed.value = false;
  void nextTick(() => back.value?.focus());
}
function goBack() {
  if (!editing.value) {
    emit("back");
    return;
  }
  editing.value = false;
  void nextTick(() => {
    if (list.value) list.value.scrollTop = listScroll;
    back.value?.focus();
  });
}
function addKeyword() {
  if (!draft.value || draftKeywords.value.length > 32) return;
  draft.value.keywords = draftKeywords.value;
  keyword.value = "";
}

async function toggle(entry: PrivateModBook["entries"][number]) {
  if (busy.value || !book.value || !props.changeEntry) return;
  const ok = await props.changeEntry({ action: "private_entry", entryId: entry.id, enabled: !entry.enabled }, entry.id, props.version ?? book.value.version);
  failedToggle.value = ok ? "" : entry.id;
  await load();
}
async function save(remove: boolean) {
  if (!draft.value || !book.value || busy.value || props.settingsBusy || loading.value) return;
  formTried.value = !remove;
  if (!remove && (!draft.value.content.trim() || chars(draft.value.content) > maxEntryChars.value || nextResidentChars.value > CONSTANT_CHAR_LIMIT)) return;
  const entry = { ...draft.value, keywords: draftKeywords.value };
  const all = book.value.entries;
  const entries = remove ? all.filter(row => row.id !== entry.id)
    : editedExisting.value ? all.map(row => row.id === entry.id ? entry : row)
    : [...all, entry];
  busy.value = true;
  saveFailed.value = false;
  try {
    book.value = props.universal
      ? await props.universal.save(book.value.revision, entries)
      : await savePrivateMod(props.conversationId ?? "", book.value.revision, entries, await props.auth());
    draft.value = undefined;
    keyword.value = "";
    goBack();
    emit("saved");
  } catch (err) {
    saveFailed.value = true;
    if (err instanceof ApiError && err.status === 409) await load();
  } finally {
    busy.value = false;
  }
}
function removeEntry() {
  confirmDelete.value = true;
  void nextTick(() => cancelDelete.value?.focus());
}
</script>

<template>
  <section class="mod-window__section">
    <header class="mod-window__head">
      <button v-if="!universal || editing" ref="back" data-mod-back class="btn btn--ghost mod-window__icon" type="button" :aria-label="tr('back')" :disabled="busy" @click="goBack">←</button>
      <h2 id="play-private-mod-title">{{ title }}</h2>
      <button v-if="!universal" class="btn btn--ghost mod-window__icon" type="button" :aria-label="windowText('close')" @click="emit('close')">×</button>
    </header>
    <div v-if="!editing" ref="list" class="mod-window__scroll">
      <p v-if="!universal" class="mod-window__muted">{{ tr("subtitle") }}</p>
      <p v-if="loadFailed" class="mod-window__notice" role="alert">
        {{ tr("loadFailed") }}
        <button class="btn" type="button" @click="load">{{ windowText("state.retry") }}</button>
      </p>
      <div v-else-if="!book && loading" class="mod-window__skeleton" aria-busy="true" />
      <template v-else-if="book">
        <div class="mod-window__list-head">
          <p v-if="book.residentChars >= CONSTANT_CHAR_LIMIT * 0.7" class="mod-window__muted">
            {{ tr("residentMeter", { used: n(book.residentChars), max: n(CONSTANT_CHAR_LIMIT) }) }}
          </p>
          <button class="btn btn--primary" type="button" :disabled="loading" @click="enter()">{{ tr("add") }}</button>
        </div>
        <p v-if="!book.entries.length" class="mod-window__muted">{{ tr("emptyBody") }}</p>
        <ul v-else class="mod-window__list">
          <li v-for="entry in book.entries" :key="entry.id">
            <div class="mod-window__row">
              <button class="mod-window__entry" type="button" @click="enter(entry)">
                <strong>{{ entryName(entry) }}</strong>
                <span class="mod-window__meta">
                  <span v-if="entry.resident ?? !entry.keywords.length" class="chip">{{ tr("constantChip") }}</span>
                  <span v-for="word in entry.keywords.slice(0, 2)" :key="word" class="chip">{{ word }}</span>
                  <span v-if="entry.keywords.length > 2">{{ tr("moreKeywords", { n: entry.keywords.length - 2 }) }}</span>
                </span>
              </button>
              <button
                v-if="!universal" class="mod-window__switch" role="switch" type="button" :aria-checked="entry.enabled"
                :aria-label="tr('a11yToggle', { name: entryName(entry) })" :disabled="settingsBusy || loading"
                @click="toggle(entry)"
              ><span /></button>
            </div>
            <p v-if="failedToggle === entry.id" class="mod-window__row-error" role="alert">
              {{ windowText("error.toggleFailed") }}
              <button class="btn btn--ghost" type="button" :disabled="settingsBusy || loading" @click="toggle(entry)">{{ windowText("state.retry") }}</button>
            </p>
          </li>
        </ul>
      </template>
    </div>
    <form v-else-if="draft" class="mod-window__section" @submit.prevent="save(false)">
      <div class="mod-window__scroll mod-window__form">
        <label>
          {{ tr("form.nameLabel") }}
          <input v-model="draft.name" class="input" :placeholder="tr('form.namePlaceholder')" @input="draft.name = Array.from(draft.name).slice(0, 20).join('')" />
        </label>
        <div class="mod-window__form">
          <label for="mod-entry-keywords">{{ tr("form.keywordsLabel") }}</label>
          <div v-if="draft.keywords.length" class="mod-window__meta">
            <button
              v-for="word in draft.keywords" :key="word" type="button" class="btn btn--ghost"
              @click="draft.keywords = draft.keywords.filter(value => value !== word)"
            >{{ word }} <span aria-hidden="true">×</span></button>
          </div>
          <input
            id="mod-entry-keywords" v-model="keyword" class="input" maxlength="80"
            :disabled="draft.keywords.length >= 32" :placeholder="tr('form.keywordsPlaceholder')"
            aria-describedby="mod-entry-keyword-hint" @keydown.enter.prevent="addKeyword"
          />
          <p id="mod-entry-keyword-hint" class="mod-window__muted">{{ tr("form.keywordsHint") }}</p>
        </div>
        <label>
          {{ tr("form.contentLabel") }}
          <textarea v-model="draft.content" class="input" rows="5" autocomplete="off" required :placeholder="tr('form.contentPlaceholder')" />
        </label>
        <p v-if="formTried && chars(draft.content) > maxEntryChars" class="mod-window__row-error" role="alert">{{ tr("form.contentOver", { max: n(maxEntryChars) }) }}</p>
        <p v-if="formTried && nextResidentChars > CONSTANT_CHAR_LIMIT" class="mod-window__row-error" role="alert">{{ tr("form.residentOver", { max: n(CONSTANT_CHAR_LIMIT) }) }}</p>
        <p v-if="saveFailed" class="mod-window__row-error" role="alert">{{ tr("form.saveFailed") }}</p>
      </div>
      <footer class="mod-window__foot mod-window__actions">
        <template v-if="confirmDelete">
          <p>{{ tr("form.deleteConfirm") }}</p>
          <button ref="cancelDelete" class="btn" type="button" :disabled="busy" @click="confirmDelete = false">{{ tr("form.cancel") }}</button>
          <button class="btn btn--ghost mod-window__danger" type="button" :disabled="busy || settingsBusy || loading" @click="save(true)">{{ tr("form.delete") }}</button>
        </template>
        <template v-else>
          <button v-if="editedExisting" class="btn btn--ghost mod-window__danger" type="button" :disabled="busy" @click="removeEntry">{{ tr("form.delete") }}</button>
          <button class="btn btn--primary" type="submit" :disabled="busy || settingsBusy || loading || !draft.content.trim()">{{ tr("form.save") }}</button>
        </template>
      </footer>
    </form>
  </section>
</template>
