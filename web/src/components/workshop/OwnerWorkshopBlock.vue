<script setup lang="ts">
/**
 * 卡片編輯頁「發布」分區裡原作者的工坊塊（ui.md §3.6「原作者開關」、§4.7）。
 *
 *   標題「開放擴充」＋開關 → 一句說明（開放中／已暫停／已暫停且歸零）→ 別人為這張卡建立的擴充（最多三列，唯讀）
 *   →「管理這些擴充」。
 *
 * 預設開放。關閉會擋掉別人的新建立，所以先跳確認框（焦點在取消）；重新開放沒有代價，按了直接存。
 * 開關以伺服器回的為準：存失敗就重讀一次，畫面照伺服器現況，不留樂觀翻轉的假狀態。
 * 不是原作者（403）時整塊不出現——這個編輯頁也會被不是原作者的人打開（例如審核）。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import { ApiError } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchPolicy, savePolicy, type ExtensionSummary, type OwnerPolicy } from "@/lib/workshop";

const props = defineProps<{ roleId: string; cardId?: string }>();
const { t } = useI18n();
const session = useSession();
const { lp } = useLocalePath();

const policy = ref<OwnerPolicy | null>(null);
const loading = ref(false);
const failed = ref(false);
const notOwner = ref(false);
const saving = ref(false);
const error = ref("");

const items = computed(() => policy.value?.items ?? []);
const published = computed(() => items.value.filter((i) => i.version > 0).length);
const open = computed(() => !!policy.value?.allowNew);
const zero = computed(() => !open.value && items.value.length === 0);
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
async function load() {
  const n = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const got = await fetchPolicy(props.roleId, await token());
    if (n === seq) { policy.value = got; notOwner.value = false; }
  } catch (err) {
    if (n !== seq) return;
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) notOwner.value = true;
    else failed.value = true;
  } finally {
    if (n === seq) loading.value = false;
  }
}
// 編輯頁一開始的 roleId 可能是網址上的卡號，讀完卡才換成真正的角色 id；卡號查不到開關，等換好再讀
watch(() => props.roleId, (id) => { if (id && !/^[1-9]\d*$/.test(id)) void load(); }, { immediate: true });

async function toggle() {
  const current = policy.value;
  if (!current || saving.value) return;
  const next = !current.allowNew;
  if (!next) {
    const ok = await confirmDialog({
      title: t("workshop.owner.pause.title"), message: t("workshop.owner.pause.body", { n: published.value }),
      confirmText: t("workshop.owner.pause.confirm"), focusCancel: true, phraseWrap: true,
    });
    if (!ok) return;
  }
  saving.value = true;
  error.value = "";
  try {
    policy.value = await savePolicy(props.roleId, next, current.revision, await token());
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
    await load();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="!notOwner && (policy || loading || failed)" class="panel ws-owner" data-ws-owner>
    <div class="ws-owner__head">
      <h2 id="ws-owner-title">{{ $t("workshop.owner.toggle.title") }}</h2>
      <button
        v-if="policy" type="button" class="ws-switch" role="switch" :aria-checked="open" aria-labelledby="ws-owner-title"
        :disabled="saving" data-ws-owner-switch @click="toggle"
      />
    </div>

    <div v-if="!policy && loading" class="ghost ws-owner__ghost" aria-hidden="true" />
    <div v-else-if="!policy && failed" class="notice notice--error ws-owner__error" role="alert">
      <span class="ws-text">{{ $t("workshop.owner.error.load") }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>

    <template v-else-if="policy">
      <p class="muted ws-text ws-owner__desc">{{ open ? $t("workshop.owner.toggle.on") : zero ? $t("workshop.owner.toggle.pausedZero") : $t("workshop.owner.toggle.paused") }}</p>
      <p v-if="!open && published > 0" class="notice ws-text">{{ $t("workshop.owner.toggle.pausedNote", { n: published }) }}</p>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

      <div v-if="!zero" class="ws-owner__list">
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
.ws-owner__desc { margin: 0; font-size: 13.5px; line-height: 1.6; }
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
