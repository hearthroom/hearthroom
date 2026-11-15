<script setup lang="ts">
/** Author consent: closed by default, self, or open; the server owns the saved state. */
import { computed, nextTick, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import { ApiError } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchPolicy, savePolicy, type ExtensionSummary, type OwnerPolicy, type WorkshopPolicyMode } from "@/lib/workshop";

const props = defineProps<{ roleId: string; cardId?: string }>();
const { t } = useI18n();
const session = useSession();
const { lp } = useLocalePath();

const policy = ref<OwnerPolicy | null>(null);
const loading = ref(false);
const failed = ref(false);
const notOwner = ref(false);
const saving = ref(false);
const deciding = ref(false);
const choices = ref<HTMLFieldSetElement | null>(null);
const error = ref("");

const items = computed(() => (policy.value?.items ?? []).filter(item => item.byCardAuthor !== true));
const published = computed(() => items.value.filter((i) => i.version > 0).length);
const MODES: WorkshopPolicyMode[] = ["closed","self","open"];
const mode = computed<WorkshopPolicyMode>(() => MODES.includes(policy.value?.mode as WorkshopPolicyMode) ? policy.value!.mode! : "closed");
const retryMode = ref<WorkshopPolicyMode | null>(null);
const createTo = computed(() => ({path:lp("/mine/workshops/new"),query:{card:props.cardId || props.roleId}}));
const shown = computed(() => items.value.slice(0, 3));
// 從未發布的不寫版本號（「・v0」沒有意義）；會出現在這裡的通常都發布過
const meta = (ext: ExtensionSummary) => ext.version > 0
  ? t("workshop.owner.row.meta", { by: ext.author.name, count: compact(ext.joinCount), ver: `v${ext.version}` })
  : `${ext.author.name} · ${t("workshop.card.installs", { count: compact(ext.joinCount) })}`;
const manageTo = computed(() => (props.cardId ? lp(`/mine/cards/${encodeURIComponent(props.cardId)}/workshop`) : ""));

async function token() {
  const tk = await session.accessToken();
  if (!tk) throw new Error(t("auth.expired"));
  return tk;
}
let seq = 0;
let loadedRole = "";
async function load() {
  const n = ++seq;
  const roleId = props.roleId;
  let success = false;
  loading.value = true;
  failed.value = false;
  try {
    const got = await fetchPolicy(roleId, await token());
    if (n === seq) { policy.value = got; loadedRole = roleId; notOwner.value = false; success = true; }
  } catch (err) {
    if (n !== seq) return;
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) notOwner.value = true;
    else failed.value = true;
  } finally {
    if (n === seq) loading.value = false;
  }
  return success;
}
// 編輯頁一開始的 roleId 可能是網址上的卡號，讀完卡才換成真正的角色 id；卡號查不到開關，等換好再讀
watch(() => props.roleId, (id) => { if (id && !/^[1-9]\d*$/.test(id)) void load(); }, { immediate: true });

async function choose(next: WorkshopPolicyMode) {
  const current = policy.value;
  const roleId = props.roleId;
  if (!current || saving.value || deciding.value || loading.value || loadedRole !== roleId || mode.value === next) return;
  deciding.value = true;
  error.value = "";
  try {
    if (next === "open") {
      if (!(await confirmDialog({
        title:t("workshop.owner.openConfirm.title"), message:t("workshop.owner.openConfirm.lead"),
        bullets:[t("workshop.owner.openConfirm.bullet1"),t("workshop.owner.openConfirm.bullet2"),t("workshop.owner.openConfirm.bullet3")],
        confirmText:t("workshop.owner.openConfirm.confirm"), cancelText:t("dialog.cancel"), phraseWrap:true,
      }))) return;
    } else if (mode.value === "open" && (current.hasThirdParty || items.value.length > 0)) {
      if (!(await confirmDialog({
        title:t("workshop.owner.reduceConfirm.title"), message:t("workshop.owner.reduceConfirm.lead"),
        bullets:[t("workshop.owner.reduceConfirm.bullet1"),t("workshop.owner.reduceConfirm.bullet2")],
        confirmText:t("workshop.owner.reduceConfirm.confirm"), cancelText:t("dialog.cancel"), focusCancel:true, phraseWrap:true,
      }))) return;
    }
    deciding.value=false;
    saving.value=true;
    const got = await savePolicy(roleId,next,current.revision,await token());
    if (props.roleId === roleId) { policy.value=got; retryMode.value=null; }
  } catch {
    if (props.roleId !== roleId) return;
    const fresh = await load();
    // An uncertain HTTP result may already have saved. Only claim the old
    // setting remains after a fresh read proves its revision is unchanged.
    if (fresh && mode.value === next && policy.value!.revision > current.revision) retryMode.value=null;
    else {
      retryMode.value=next;
      error.value=t(fresh && policy.value!.revision === current.revision ? "workshop.owner.error.save" : "state.actionFailed");
    }
  } finally {
    saving.value=false;
    deciding.value=false;
    await nextTick();
    for (const input of choices.value?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []) input.checked=input.value===mode.value;
  }
}

</script>

<template>
  <section v-if="!notOwner && (policy || loading || failed)" class="panel ws-owner" data-ws-owner>
    <div class="ws-owner__head">
      <h2 id="ws-owner-title">{{ $t("workshop.tab.workshop") }}</h2>
    </div>

    <div v-if="!policy && loading" class="ws-owner__choices" aria-hidden="true"><div v-for="n in 3" :key="n" class="ghost ws-owner__ghost" /></div>
    <div v-else-if="!policy && failed" class="notice notice--error ws-owner__error" role="alert">
      <span class="ws-text">{{ $t("workshop.owner.error.load") }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>

    <template v-else-if="policy">
      <p class="muted ws-text ws-owner__desc">{{ $t("workshop.owner.policy.desc") }}</p>
      <fieldset ref="choices" class="ws-owner__choices" aria-labelledby="ws-owner-title" :aria-busy="saving || undefined">
        <label v-for="option in MODES" :key="option" class="ws-owner__choice" :class="{'ws-owner__choice--on':mode===option}">
          <input type="radio" :name="`ws-policy-${roleId}`" :value="option" :checked="mode===option" :disabled="saving || loading" data-ws-policy-mode @click.prevent="choose(option)" />
          <span><strong>{{ $t(`workshop.owner.mode.${option}`) }}</strong><small>{{ $t(`workshop.owner.mode.${option}.desc`) }}</small></span>
        </label>
      </fieldset>
      <p v-if="mode !== 'open' && published > 0" class="notice ws-text">{{ $t("workshop.owner.policy.hiddenThirdPartyNote",{n:published},published) }}</p>
      <div v-if="error" class="notice notice--error ws-owner__error" role="alert"><span>{{ error }}</span><button v-if="retryMode" type="button" class="btn btn--sm" :disabled="saving" @click="choose(retryMode)">{{ $t("library.retry") }}</button></div>
      <RouterLink v-if="mode !== 'closed'" :to="createTo" class="btn btn--sm ws-owner__manage">{{ $t("workshop.owner.createForCard") }}</RouterLink>

      <div v-if="items.length" class="ws-owner__list">
        <h3>{{ $t("workshop.owner.list.title", { n: items.length }) }}</h3>
        <ul v-if="shown.length">
          <li v-for="ext in shown" :key="ext.id" class="ws-owner__row">
            <ExtensionCover class="ws-owner__ico" :src="ext.coverUrl" :name="ext.name" square />
            <span class="ws-owner__text">
              <strong>{{ ext.name }}</strong>
              <span class="subtle">{{ meta(ext) }}</span>
            </span>
          </li>
        </ul>
        <RouterLink v-if="manageTo" :to="manageTo" class="btn btn--sm ws-owner__manage">{{ $t("workshop.owner.list.manage") }}</RouterLink>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ws-owner { display: grid; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
.ws-owner__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.ws-owner__head h2 { margin: 0; font-size: 16px; font-weight: 600; }
.ws-owner__desc { margin: 0; font-size: 13px; line-height: 1.6; }
.ws-owner__choices { display:grid; gap:var(--s-3); padding:0; margin:0; border:0; min-width:0; }
.ws-owner__choice { display:flex; gap:var(--s-3); align-items:flex-start; padding:var(--s-3); border:1px solid var(--line); border-radius:var(--r-sm); cursor:pointer; min-height:var(--h-lg); }
.ws-owner__choice--on { background:var(--accent-tint); border-color:var(--accent); }
.ws-owner__choice input { margin-top:var(--s-1); accent-color:var(--accent); flex-shrink:0; }
.ws-owner__choice span { min-width:0; }
.ws-owner__choice strong { display:block; font-size:14px; font-weight:600; }
.ws-owner__choice small { display:block; color:var(--text-2); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.ws-owner:lang(ko) :is(strong,small,.ws-text) { word-break:keep-all; overflow-wrap:anywhere; }
.ws-owner:lang(ja) :is(strong,small,.ws-text) { word-break:auto-phrase; }
.ws-owner__ghost { height: 72px; border-radius: var(--r-md); }
.ws-owner__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.ws-owner__list { display: grid; gap: var(--s-2); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.ws-owner__list h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.ws-owner__list ul { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.ws-owner__row { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.ws-owner__ico { width: 40px; border-radius: var(--r-sm); }
.ws-owner__text { display: grid; gap: 2px; min-width: 0; }
.ws-owner__text strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-owner__text .subtle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-owner__manage { justify-self: start; }
</style>
