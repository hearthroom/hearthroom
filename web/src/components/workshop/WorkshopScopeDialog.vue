<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchWorkshopCards, saveUniversalMod, type WorkshopCardChoice } from "@/lib/workshop";

const props = defineProps<{ initialUniversal?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const router = useRouter();
const session = useSession();
const dialog = ref<HTMLDialogElement | null>(null);
const scope = ref<"card" | "universal">(props.initialUniversal ? "universal" : "card");
const search = ref("");
const card = ref("");
const items = ref<WorkshopCardChoice[]>([]);
const loading = ref(false);
const creating = ref(false);
const failed = ref(false);
const createFailed = ref(false);
const operation = crypto.randomUUID();
const canCreate = computed(() => scope.value === "universal" || !!items.value.find((item) => item.cardId === card.value && item.allowNew));
let requestSequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function token() {
  const access = await session.accessToken();
  if (!access) throw new Error(t("auth.expired"));
  return access;
}
async function load() {
  const request = ++requestSequence;
  if (scope.value !== "card") return;
  loading.value = true;
  failed.value = false;
  try {
    const { items: next } = await fetchWorkshopCards(search.value, await token());
    if (request !== requestSequence) return;
    items.value = next;
    if (!next.some((item) => item.cardId === card.value)) card.value = "";
  } catch {
    if (request === requestSequence) failed.value = true;
  } finally {
    if (request === requestSequence) loading.value = false;
  }
}
watch(search, () => { clearTimeout(timer); timer = setTimeout(load, 300); });
watch(scope, (value) => { if (value === "card") void load(); }, { immediate: true });
onMounted(async () => {
  await nextTick();
  dialog.value?.showModal();
});
onBeforeUnmount(() => { clearTimeout(timer); requestSequence++; });

async function create() {
  if (creating.value || !canCreate.value) return;
  creating.value = true;
  createFailed.value = false;
  try {
    if (scope.value === "card") {
      await router.push({ path: lp("/mine/workshops/new"), query: { card: card.value } });
    } else {
      const draft = await saveUniversalMod({
        id: operation, revision: "00000000-0000-0000-0000-000000000000", name: "", summary: "", entries: [],
      }, await token());
      await router.push({ path: lp(`/mine/workshops/${encodeURIComponent(draft.id)}/edit`), query: { scope: "universal" } });
    }
    emit("close");
  } catch {
    createFailed.value = true;
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="panel workshop-scope" aria-labelledby="workshop-scope-title"
            @cancel.prevent="!creating && emit('close')" @click.self="!creating && emit('close')">
      <form class="workshop-scope__form" @submit.prevent="create">
        <h2 id="workshop-scope-title">{{ $t("workshop.scopeModal.title") }}</h2>
        <div class="workshop-scope__option">
          <label>
            <input v-model="scope" type="radio" value="card" name="workshop-scope" :disabled="creating" />
            <span><strong>{{ $t("workshop.scopeModal.card.title") }}</strong><span class="muted">{{ $t("workshop.scopeModal.card.desc") }}</span></span>
          </label>
          <div v-if="scope === 'card'" class="workshop-scope__picker" :aria-busy="loading || undefined">
            <input v-model="search" type="search" class="input" maxlength="100" :aria-label="$t('workshop.mine.pick.search')" :placeholder="$t('workshop.mine.pick.search')" />
            <label class="workshop-scope__label" for="workshop-scope-card">{{ $t("workshop.scopeModal.card.pickLabel") }}</label>
            <select id="workshop-scope-card" v-model="card" class="input" :disabled="creating || loading">
              <option disabled value="">{{ $t("workshop.scopeModal.card.pickLabel") }}</option>
              <option v-for="item in items" :key="item.cardId" :value="item.cardId" :disabled="!item.allowNew">{{ item.name }}</option>
            </select>
            <p v-if="failed" class="notice notice--error" role="alert">
              {{ $t("state.loadFailed") }} <button class="btn btn--sm" type="button" @click="load">{{ $t("library.retry") }}</button>
            </p>
          </div>
        </div>
        <div class="workshop-scope__option">
          <label>
            <input v-model="scope" type="radio" value="universal" name="workshop-scope" :disabled="creating" />
            <span><strong>{{ $t("workshop.scopeModal.universal.title") }}</strong><span class="muted">{{ $t("workshop.scopeModal.universal.desc") }}</span></span>
          </label>
        </div>
        <p v-if="createFailed" class="notice notice--error" role="alert">{{ $t("state.actionFailed") }}</p>
        <footer>
          <button class="btn" type="button" :disabled="creating" @click="emit('close')">{{ $t("dialog.cancel") }}</button>
          <button class="btn btn--primary" type="submit" :disabled="creating || !canCreate">{{ $t("workshop.scopeModal.confirm") }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.workshop-scope { width: min(480px, calc(100% - 28px)); max-height: 88dvh; padding: var(--s-5); color: var(--text); background: var(--surface); }
.workshop-scope::backdrop { background: var(--overlay, #0008); }
.workshop-scope h2, .workshop-scope p { margin: 0; }
.workshop-scope__form, .workshop-scope__picker { display: grid; gap: var(--s-3); }
.workshop-scope__option { display: grid; gap: var(--s-2); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s-3); }
.workshop-scope__option label { display: flex; align-items: flex-start; gap: var(--s-2); }
.workshop-scope__option label > span { display: grid; gap: var(--s-1); }
.workshop-scope__picker { grid-template-columns: minmax(0, 1fr); }
.workshop-scope__label { font-weight: 600; }
.workshop-scope footer { display: flex; justify-content: flex-end; gap: var(--s-2); }
@media (max-width: 640px) {
  .workshop-scope { inset: auto 0 0; position: fixed; width: 100%; max-width: 100%; margin: 0; }
}
</style>
