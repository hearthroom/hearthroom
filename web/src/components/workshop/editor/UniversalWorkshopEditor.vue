<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { entryContentMax } from "@/lib/tavern";
import { deleteUniversalMod, getUniversalMod, saveUniversalMod } from "@/lib/workshop";
import type { PrivateModEntry, UniversalMod } from "@/lib/workshop-mods";
import FieldText from "@/components/editor/FieldText.vue";
import PlayPrivateModEntries from "../PlayPrivateModEntries.vue";
import LineTabs from "../LineTabs.vue";

const props = defineProps<{ workshopId: string }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const router = useRouter();
const draft = ref<UniversalMod | null>(null);
const name = ref("");
const summary = ref("");
const loading = ref(true);
const busy = ref(false);
const failed = ref(false);
const writeFailed = ref(false);
const tab = ref<"basic" | "world" | "share">("basic");
const mine = computed(() => lp("/mine?tab=workshops"));
const dirty = computed(() => !!draft.value && (name.value !== draft.value.name || summary.value !== draft.value.summary));
const tabs = computed(() => [
  { key: "basic" as const, label: t("workshop.editor.section.basic") },
  { key: "world" as const, label: t("editor.section.worldbook") },
  { key: "share" as const, label: t("workshop.share.tab") },
]);

async function token() {
  const access = await session.accessToken();
  if (!access) throw new Error(t("auth.expired"));
  return access;
}

function adopt(book: UniversalMod) {
  draft.value = book;
  name.value = book.name;
  summary.value = book.summary;
}

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    adopt(await getUniversalMod(props.workshopId, await token()));
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
watch(() => props.workshopId, () => { void load(); }, { immediate: true });

async function saveBasic() {
  if (busy.value || !draft.value) return false;
  if (!dirty.value) return true;
  busy.value = true;
  writeFailed.value = false;
  const sent = { ...draft.value, name: name.value, summary: summary.value };
  try {
    const latest = await saveUniversalMod(sent, await token());
    draft.value = latest;
    if (name.value === sent.name) name.value = latest.name;
    if (summary.value === sent.summary) summary.value = latest.summary;
    return true;
  } catch {
    writeFailed.value = true;
    return false;
  } finally {
    busy.value = false;
  }
}

async function selectTab(next: typeof tab.value) {
  if (tab.value !== next && await saveBasic()) tab.value = next;
}

function project(book: UniversalMod) {
  const residentChars = book.entries.reduce((n, entry) => n + (entry.keywords.length ? 0 : [...entry.content].length), 0);
  return {
    revision: book.revision, version: book.revision, entries: book.entries.map((entry) => ({ ...entry, enabled: true })),
    // The Provider uses one content limit for an extension shared across cards and languages.
    residentChars, entryContentMax: entryContentMax("en"),
  };
}

const universal = {
  async load() {
    const latest = await getUniversalMod(props.workshopId, await token());
    adopt(latest);
    return project(latest);
  },
  async save(revision: string, entries: PrivateModEntry[]) {
    if (!draft.value || busy.value || draft.value.revision !== revision) throw new Error(t("workshop.editor.stale"));
    const clean = entries.map(({ id, name, content, keywords }) => ({ id, name, content, keywords }));
    const latest = await saveUniversalMod({ ...draft.value, entries: clean }, await token());
    adopt(latest);
    return project(latest);
  },
};

async function remove() {
  if (!draft.value || busy.value || !await confirmDialog({
    title: t("workshop.delete.title", { name: draft.value.name || t("workshop.mine.row.untitled") }),
    message: t("workshop.delete.bodyNone"), confirmText: t("workshop.delete.confirm"), focusCancel: true, danger: true,
  })) return;
  busy.value = true;
  writeFailed.value = false;
  try {
    await deleteUniversalMod(draft.value.id, draft.value.revision, await token());
    await router.push(mine.value);
  } catch {
    writeFailed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="universal-editor">
    <header class="universal-editor__header">
      <h1 class="display">{{ $t("workshop.mine.edit") }}</h1>
      <span class="chip">{{ $t("workshop.layer.universal") }}</span>
      <RouterLink :to="mine" class="btn btn--ghost btn--sm">{{ $t("workshop.window.universal.manageLink") }}</RouterLink>
    </header>
    <div v-if="loading" class="ghost universal-editor__ghost" aria-busy="true" />
    <div v-else-if="failed || !draft" class="notice notice--error" role="alert">
      {{ $t("state.loadFailed") }} <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>
    <template v-else>
      <LineTabs :model-value="tab" :tabs="tabs" id-prefix="universal-editor" :label="$t('editor.sections')" @update:model-value="selectTab" />
      <section id="universal-editor-panel" class="panel universal-editor__pane" role="tabpanel" :aria-labelledby="`universal-editor-tab-${tab}`">
        <p v-if="writeFailed" class="notice notice--error" role="alert">{{ $t("state.saveFailed") }}</p>
        <form v-if="tab === 'basic'" class="universal-editor__form" @submit.prevent="saveBasic">
          <FieldText id="universal-name" v-model="name" :label="$t('workshop.editor.name')" :max="16" />
          <FieldText id="universal-summary" v-model="summary" :label="$t('workshop.editor.summary')" :max="500" :rows="2" />
          <button class="btn btn--primary" :disabled="busy || !dirty" type="submit">{{ $t("workshop.editor.toolbar.save") }}</button>
        </form>
        <PlayPrivateModEntries v-else-if="tab === 'world'" shown :auth="token" :universal="universal" :settings-busy="busy" />
        <template v-else>
          <h2>{{ $t("workshop.share.sectionTitle") }}</h2>
          <p class="muted ws-text">{{ $t("workshop.share.desc.universal") }}</p>
          <button class="btn btn--sm btn--danger" :disabled="busy" type="button" @click="remove">{{ $t("workshop.delete.button") }}</button>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.universal-editor { display: grid; gap: var(--s-4); width: min(100%, 800px); }
.universal-editor h1, .universal-editor h2, .universal-editor p { margin: 0; }
.universal-editor__header { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-3); }
.universal-editor__ghost { min-height: 140px; }
.universal-editor__pane, .universal-editor__form { display: grid; gap: var(--s-3); padding: var(--s-4); min-width: 0; }
.universal-editor__form { padding: 0; }
.universal-editor__pane .btn { justify-self: start; }
</style>
