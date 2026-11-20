<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import type { LorePackDraft } from "@/lib/workshop";
import type { WorldbookEntryDraft } from "@/lib/role-draft";

const props = defineProps<{ entries: WorldbookEntryDraft[] }>();
const packs = defineModel<LorePackDraft[]>("packs", { required: true });
const scriptCanSwitch = defineModel<boolean>("scriptCanSwitch", { required: true });
const emit = defineEmits<{ remove: [packId: string] }>();
const { t, n } = useI18n();
const tr = (key: string, params: Record<string, string | number> = {}) => t("wb.packs." + key, params);
const menu = ref("");
const dialog = ref<HTMLDialogElement | null>(null);
const draft = ref<LorePackDraft>();
const field = ref<"all" | "name" | "description">("all");
const tried = ref(false);

const entryCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const entry of props.entries) {
    if (entry.packId) counts.set(entry.packId, (counts.get(entry.packId) ?? 0) + 1);
  }
  return counts;
});
const invalid = computed(() => {
  const form = draft.value;
  if (!form) return "";
  const name = form.name.trim();
  if (Array.from(name).length > 12) return tr("form.nameTooLong", { max: 12 });
  if (Array.from((form.description ?? "").trim()).length > 24) return tr("form.descTooLong", { max: 24 });
  if (packs.value.some(pack => pack.id !== form.id && pack.name.trim().toLowerCase() === name.toLowerCase())) return tr("form.nameTaken");
  return "";
});

function edit(pack?: LorePackDraft, part: typeof field.value = "all") {
  menu.value = "";
  field.value = part;
  tried.value = false;
  draft.value = pack ? { ...pack } : { id: crypto.randomUUID(), name: "", description: "", defaultEnabled: true };
  void nextTick(() => dialog.value?.showModal());
}
function close() {
  dialog.value?.close();
  draft.value = undefined;
}
function save() {
  if (!draft.value) return;
  tried.value = true;
  const pack = { ...draft.value, name: draft.value.name.trim(), description: draft.value.description?.trim() };
  if (invalid.value || !pack.name) return;
  packs.value = packs.value.some(item => item.id === pack.id)
    ? packs.value.map(item => item.id === pack.id ? pack : item)
    : [...packs.value, pack];
  close();
}
function toggleDefault(pack: LorePackDraft) {
  packs.value = packs.value.map(item => item.id === pack.id ? { ...item, defaultEnabled: !item.defaultEnabled } : item);
  menu.value = "";
}
async function remove(pack: LorePackDraft) {
  menu.value = "";
  if (!await confirmDialog({
    title: tr("delete.title", { name: pack.name }),
    message: tr("delete.body", { n: n(entryCounts.value.get(pack.id) ?? 0) }),
    confirmText: tr("delete.confirm"), danger: true, dangerAppearance: "subdued",
  })) return;
  emit("remove", pack.id);
  packs.value = packs.value.filter(item => item.id !== pack.id);
  if (!packs.value.length) scriptCanSwitch.value = false;
}
</script>

<template>
  <section class="workshop-packs panel" aria-labelledby="workshop-packs-title">
    <h3 id="workshop-packs-title">{{ tr("title") }}</h3>
    <p class="subtle">{{ tr("hint") }}</p>
    <p v-if="!packs.length" class="subtle">{{ tr("empty") }}</p>
    <ul v-else class="workshop-packs__list">
      <li v-for="pack in packs" :key="pack.id" class="workshop-packs__row">
        <strong>{{ pack.name }}</strong>
        <span class="subtle workshop-packs__count">{{ tr("rowCount", { n: n(entryCounts.get(pack.id) ?? 0) }) }}</span>
        <span class="chip">{{ tr(pack.defaultEnabled ? "chipDefaultOn" : "chipDefaultOff") }}</span>
        <button class="btn btn--ghost" type="button" :aria-label="tr('menuAria', { name: pack.name })" :aria-expanded="menu === pack.id"
                @click="menu = menu === pack.id ? '' : pack.id">⋯</button>
        <div v-if="menu === pack.id" class="workshop-packs__menu" @keydown.esc.stop="menu = ''">
          <button class="btn btn--ghost" type="button" @click="edit(pack, 'name')">{{ tr("menuRename") }}</button>
          <button class="btn btn--ghost" type="button" @click="edit(pack, 'description')">{{ tr("menuEditDesc") }}</button>
          <button class="btn btn--ghost" type="button" @click="toggleDefault(pack)">{{ tr(pack.defaultEnabled ? "menuSetDefaultOff" : "menuSetDefaultOn") }}</button>
          <button class="btn btn--ghost btn--danger" type="button" @click="remove(pack)">{{ tr("menuDelete") }}</button>
        </div>
      </li>
    </ul>
    <button type="button" class="btn" :disabled="packs.length >= 100" @click="edit()">{{ tr("add") }}</button>
    <div class="workshop-packs__script">
      <label>
        <input v-model="scriptCanSwitch" role="switch" type="checkbox" :disabled="!packs.length" aria-describedby="workshop-packs-permission" />
        {{ tr("scriptSwitch.label") }}
      </label>
      <p id="workshop-packs-permission" class="subtle">{{ tr(packs.length ? "scriptSwitch.desc" : "scriptSwitch.disabledEmpty") }}</p>
    </div>
  </section>

  <Teleport to="body">
    <dialog ref="dialog" class="mod-window workshop-packs__dialog" aria-labelledby="workshop-pack-form-title" @cancel.prevent="close" @click.self="close">
      <form v-if="draft" class="mod-window__section" @submit.prevent="save">
        <header class="mod-window__head">
          <h2 id="workshop-pack-form-title">{{ tr(field === "all" ? "form.newTitle" : "form.editTitle") }}</h2>
        </header>
        <div class="mod-window__scroll mod-window__form">
          <label v-if="field !== 'description'">
            {{ tr("form.nameLabel") }}
            <input v-model="draft.name" class="input" required :placeholder="tr('form.namePlaceholder')" />
          </label>
          <label v-if="field !== 'name'">
            {{ tr("form.descLabel") }}
            <input v-model="draft.description" class="input" :placeholder="tr('form.descPlaceholder')" />
          </label>
          <label v-if="field === 'all'">
            <span><input v-model="draft.defaultEnabled" type="checkbox" /> {{ tr("form.defaultOnLabel") }}</span>
            <span class="subtle">{{ tr("form.defaultOnHint") }}</span>
          </label>
          <p v-if="tried && invalid" role="alert" class="mod-window__row-error">{{ invalid }}</p>
        </div>
        <footer class="mod-window__foot">
          <button class="btn" type="button" @click="close">{{ t("dialog.cancel") }}</button>
          <button class="btn btn--primary" type="submit" :disabled="!draft.name.trim()">{{ t("workshop.mineEntries.form.save") }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.workshop-packs { display: grid; justify-items: start; gap: var(--s-3); padding: var(--s-4); }
.workshop-packs h3, .workshop-packs p { margin: 0; }
.workshop-packs__list { margin: 0; padding: 0; list-style: none; width: 100%; }
.workshop-packs__row { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); min-height: 48px; }
.workshop-packs__row + .workshop-packs__row { border-top: 1px solid var(--line); }
.workshop-packs__row strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.workshop-packs__row > button { width: 44px; height: 44px; padding: 0; }
.workshop-packs__menu {
  position: absolute; inset-inline-end: 0; inset-block-start: 100%; z-index: 2;
  display: grid; padding: 4px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm);
}
.workshop-packs__menu button { justify-content: flex-start; min-height: 44px; }
.workshop-packs__script { display: grid; gap: 4px; }
.workshop-packs__script label { min-height: 44px; display: flex; align-items: center; gap: 8px; }
.workshop-packs__dialog { max-width: min(420px, 100vw); }
@media (max-width: 640px) {
  .workshop-packs__count { display: none; }
  .workshop-packs__dialog { max-width: none; }
}
</style>
