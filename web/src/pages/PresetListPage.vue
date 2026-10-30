<script setup lang="ts">
/**
 * 我的預設：自己寫的與從酒館匯入的預設，私人資產，只有本人看得到。
 *
 * 這一頁只管預設本身（建立、匯入、匯出、另存副本、刪除）。哪張卡、哪段對話用哪個預設，是在遊玩畫布的
 * 回覆偏好裡由玩家自己為那張卡選的——沒有「全部的卡都用這個」的選項（owner 2026-10-29）。
 *
 * 刪除不一定真的刪：還有對話在用、或發布過的版本，上游只會封存，原本的對話照常。
 * 能刪還是只能封存由上游的 allowedActions 決定，結果照回來的 disposition 講，不自己猜。
 *
 * P2 分享：頁首下三格「我的／喜愛與用過／公開」，選中的那格記在網址的 ?tab=（重新整理還在）。
 * 「我的」的選單多了公開／改回私人；改回私人不另外確認（PM 2026-10-30），完成後 toast 一行說明。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/lib/api";
import { pageTitle } from "@/lib/i18n";
import { dateTime, whole } from "@/lib/format";
import { confirmDialog } from "@/lib/confirm";
import { archivePreset, deletePreset, listPresets, resultUnknown, unpublishPreset, type PresetList, type PresetSummary, type WriteReceipt } from "@/lib/presets";
import { operationKeys, usePresetAccess } from "@/lib/use-preset-access";
import { useLocalePath } from "@/lib/use-locale";
import PresetExportDialog from "@/components/preset/PresetExportDialog.vue";
import PresetCopyDialog from "@/components/preset/PresetCopyDialog.vue";
import PresetReauth from "@/components/preset/PresetReauth.vue";
import PresetPublishSheet from "@/components/preset/PresetPublishSheet.vue";
import PresetShelfTab from "@/components/preset/PresetShelfTab.vue";
import PresetLibraryTab from "@/components/preset/PresetLibraryTab.vue";

const { t } = useI18n();
const { lp } = useLocalePath();
const router = useRouter();
const { token, needsConsent, consentNeeded, reauthorize } = usePresetAccess();
const ops = operationKeys();

const items = ref<PresetSummary[]>([]);
const quota = ref<PresetList["quota"] | null>(null);
const cursor = ref("");
const loading = ref(true);
const loadingMore = ref(false);
const loadFailed = ref(false);
const showArchived = ref(false);
const busy = ref("");
const status = ref("");
const actionError = ref("");
const menu = ref("");
const exporting = ref<PresetSummary | null>(null);
const copying = ref<PresetSummary | null>(null);

const route = useRoute();
const TABS = ["mine", "fav", "public"] as const;
type Tab = (typeof TABS)[number];
const tab = computed<Tab>(() => (TABS as readonly string[]).includes(String(route.query.tab)) ? (route.query.tab as Tab) : "mine");
const tabLink = (k: Tab) => ({ path: lp("/me/presets"), query: k === "mine" ? {} : { tab: k } });
const declaration = ref("");
const publishing = ref<PresetSummary | null>(null);
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 5000);
}
function shareConsent(err: unknown) { consentNeeded(err); }

const shown = computed(() => items.value.filter((p) => showArchived.value || !p.archived));
const full = computed(() => !!quota.value && quota.value.used >= quota.value.limit);

async function load(more = false) {
  if (more) loadingMore.value = true;
  else { loading.value = !items.value.length; loadFailed.value = false; }
  try {
    const page = await listPresets(await token(), more ? cursor.value : "");
    items.value = more ? [...items.value, ...page.items] : page.items;
    quota.value = page.quota;
    if (!more) declaration.value = page.declarationVersion ?? "";
    cursor.value = page.nextCursor;
  } catch (err) {
    if (!consentNeeded(err)) loadFailed.value = true;
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function remove(p: PresetSummary) {
  menu.value = "";
  const archiveOnly = !p.allowedActions.includes("delete");
  const kind = archiveOnly ? "archive" : "delete";
  const ok = await confirmDialog({
    title: t(`preset.${kind}.title`, { name: p.title }), message: t(`preset.${kind}.body`),
    confirmText: t(`preset.${kind}.confirm`), cancelText: t(`preset.${kind}.keep`), danger: !archiveOnly, focusCancel: true,
  });
  if (!ok) return;
  const action = `${kind}:${p.id}`;
  busy.value = p.id;
  actionError.value = "";
  status.value = "";
  try {
    const receipt: WriteReceipt = archiveOnly
      ? await archivePreset(await token(), p.id, p.version, ops.key(action))
      : await deletePreset(await token(), p.id, p.version, ops.key(action));
    ops.done(action);
    status.value = archiveOnly ? t("preset.archive.done", { name: p.title })
      : receipt.disposition === "archived" ? t("preset.disposition.archivedInstead", { name: p.title })
      : t("preset.delete.done", { name: p.title });
    await load();
  } catch (err) {
    if (!resultUnknown(err)) ops.done(action);
    if (consentNeeded(err)) return;
    actionError.value = resultUnknown(err) ? t("preset.error.unknown") : err instanceof Error ? err.message : t("preset.error.unavailable");
    if (err instanceof ApiError && err.code === "preset_conflict") void load();
  } finally {
    busy.value = "";
  }
}

function published(p: PresetSummary) {
  publishing.value = null;
  say(t("preset.share.published.toast", { name: p.title }));
  void load();
}

async function unpublish(p: PresetSummary) {
  menu.value = "";
  const action = `unpublish:${p.id}`;
  busy.value = p.id;
  actionError.value = "";
  try {
    await unpublishPreset(await token(), p.id, p.version, ops.key(action));
    ops.done(action);
    say(t("preset.share.unpublished.toast"));
    await load();
  } catch (err) {
    if (!resultUnknown(err)) ops.done(action);
    if (consentNeeded(err)) return;
    actionError.value = resultUnknown(err) ? t("preset.error.unknown") : err instanceof Error ? err.message : t("preset.error.unavailable");
    if (err instanceof ApiError && err.code === "preset_conflict") void load();
  } finally {
    busy.value = "";
  }
}

function copied(receipt: WriteReceipt, name: string) {
  copying.value = null;
  status.value = t("preset.copy.done", { name });
  void load();
  void router.push(lp(`/me/presets/${receipt.presetId}`));
}

function openMenu(id: string) { menu.value = menu.value === id ? "" : id; }
const closeMenu = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".presets__menuWrap")) menu.value = ""; };
const escMenu = (e: KeyboardEvent) => { if (e.key === "Escape") menu.value = ""; };

onMounted(() => {
  document.title = pageTitle(t("preset.title"));
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", escMenu);
  void load();
});
onBeforeUnmount(() => { document.removeEventListener("click", closeMenu); document.removeEventListener("keydown", escMenu); clearTimeout(toastTimer); });
</script>

<template>
  <div class="page presets">
    <header class="presets__head">
      <div>
        <h1 class="display">{{ $t("preset.title") }}</h1>
        <p class="muted">{{ $t("preset.lede") }}</p>
      </div>
      <div v-if="!needsConsent && tab === 'mine'" class="presets__actions">
        <RouterLink :to="lp('/me/presets/import')" class="btn" :class="{ 'is-disabled': full }" :aria-disabled="full || undefined" data-testid="preset-import">{{ $t("preset.import") }}</RouterLink>
        <RouterLink :to="lp('/me/presets/new')" class="btn btn--primary" :class="{ 'is-disabled': full }" :aria-disabled="full || undefined" data-testid="preset-create">{{ $t("preset.create") }}</RouterLink>
      </div>
    </header>

    <nav v-if="!needsConsent" class="seg presets__tabs" :aria-label="$t('preset.share.tabs.label')" data-testid="preset-tabs">
      <RouterLink
        v-for="k in TABS" :key="k" :to="tabLink(k)" replace class="seg__item presets__tab" :class="{ 'seg__item--on': tab === k }"
        :aria-current="tab === k ? 'page' : undefined" :data-testid="`preset-tab-${k}`"
      >{{ $t(`preset.share.tabs.${k}`) }}</RouterLink>
    </nav>

    <PresetReauth v-if="needsConsent" @confirm="reauthorize" @cancel="router.push(lp('/me'))" />

    <PresetShelfTab v-else-if="tab === 'fav'" :token="token" @toast="say" @consent="shareConsent" @browse="router.replace(tabLink('public'))" />
    <PresetLibraryTab v-else-if="tab === 'public'" :token="token" @toast="say" @consent="shareConsent" />

    <template v-else>
      <p class="subtle presets__mine-note" data-testid="preset-mine-note">{{ $t("preset.share.mine.note") }}</p>
      <div v-if="quota" class="presets__meta">
        <p class="subtle" data-testid="preset-quota">
          {{ $t("preset.quota", { used: whole(quota.used), limit: whole(quota.limit) }) }}
          <template v-if="quota.archived > 0"> · {{ $t("preset.quotaArchived", { archived: whole(quota.archived) }) }}</template>
        </p>
        <label v-if="quota.archived > 0" class="presets__toggle">
          <input v-model="showArchived" type="checkbox" data-testid="preset-show-archived" />
          <span>{{ $t("preset.list.showArchived") }}</span>
        </label>
      </div>
      <p v-if="full" class="notice">{{ $t("preset.error.quota", { limit: whole(quota!.limit) }) }}</p>
      <p class="subtle presets__status" role="status">{{ status }}</p>
      <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

      <ul v-if="loading" class="presets__list" aria-busy="true">
        <li v-for="n in 3" :key="n" class="panel presets__row ghost" />
      </ul>
      <section v-else-if="loadFailed" class="panel presets__card" role="alert">
        <h2>{{ $t("preset.list.loadFailed") }}</h2>
        <p v-if="items.length" class="muted">{{ $t("preset.list.loadFailed.hint") }}</p>
        <button type="button" class="btn btn--sm" @click="load()">{{ $t("preset.list.retry") }}</button>
      </section>
      <section v-else-if="!shown.length" class="panel presets__card" data-testid="preset-empty">
        <h2>{{ $t("preset.list.empty.title") }}</h2>
        <p class="muted">{{ $t("preset.list.empty.body") }}</p>
      </section>

      <ul v-if="!loading && shown.length" class="presets__list">
        <li v-for="p in shown" :key="p.id" class="panel presets__row" data-testid="preset-row">
          <RouterLink :to="lp(`/me/presets/${p.id}`)" class="presets__main">
            <strong class="presets__name">{{ p.title }}</strong>
            <span class="presets__facts subtle">
              <span>{{ $t("preset.row.version", { n: p.version }) }}</span>
              <span class="chip presets__chip">{{ $t(p.sourceKind === "imported" ? "preset.row.source.import" : "preset.row.source.native") }}</span>
              <span v-if="p.archived" class="chip presets__chip">{{ $t("preset.row.archived") }}</span>
              <span v-if="p.removed" class="chip presets__chip presets__chip--strong" data-testid="preset-taken-down">{{ $t("preset.share.chip.takenDown") }}</span>
              <span v-else-if="p.visibility === 'public'" class="chip presets__chip presets__chip--public" data-testid="preset-public">{{ $t("preset.share.chip.public") }}</span>
              <span v-if="p.bindingCount > 0">{{ $t("preset.row.inUse", { n: whole(p.bindingCount) }, p.bindingCount) }}</span>
              <span>{{ $t("preset.row.updated", { datetime: dateTime(p.updatedAt) }) }}</span>
            </span>
            <span v-if="p.removed" class="subtle presets__note">{{ $t("preset.share.takenDown.note") }}</span>
          </RouterLink>
          <div class="presets__rowActions">
            <!-- 封存的不能編輯：不給編輯鈕，點名稱打開是唯讀（QA N03） -->
            <RouterLink v-if="!p.archived" :to="lp(`/me/presets/${p.id}`)" class="btn btn--sm">{{ $t("preset.row.edit") }}</RouterLink>
            <div class="presets__menuWrap">
              <button type="button" class="btn btn--sm btn--icon" :aria-label="$t('preset.row.more')" :aria-expanded="menu === p.id" :disabled="busy === p.id" data-testid="preset-more" @click="openMenu(p.id)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /></svg>
              </button>
              <div v-if="menu === p.id" class="presets__menu panel" role="menu">
                <button type="button" role="menuitem" @click="menu = ''; exporting = p">{{ $t("preset.row.export") }}</button>
                <button v-if="!p.archived" type="button" role="menuitem" :disabled="full" @click="menu = ''; copying = p">{{ $t("preset.row.copy") }}</button>
                <button v-if="p.visibility === 'public' && !p.removed" type="button" role="menuitem" data-testid="preset-unpublish" @click="unpublish(p)">{{ $t("preset.share.menu.unpublish") }}</button>
                <button v-else-if="!p.archived" type="button" role="menuitem" :disabled="p.removed || !declaration" data-testid="preset-publish" @click="menu = ''; publishing = p">{{ $t("preset.share.menu.publish") }}</button>
                <button v-if="!p.archived && p.allowedActions.length" type="button" role="menuitem" class="presets__danger" data-testid="preset-remove" @click="remove(p)">
                  {{ $t(p.allowedActions.includes("delete") ? "preset.row.delete" : "preset.row.archive") }}
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>
      <button v-if="cursor && !loading" type="button" class="btn presets__more" :disabled="loadingMore" @click="load(true)">{{ $t("preset.list.more") }}</button>
    </template>

    <PresetExportDialog v-if="exporting" :preset="exporting" :token="token" @close="exporting = null" />
    <PresetCopyDialog v-if="copying" :source="copying" :token="token" @close="copying = null" @done="copied" />
    <PresetPublishSheet v-if="publishing" :preset="publishing" :declaration="declaration" :token="token" @close="publishing = null" @done="published(publishing!)" @stale="load()" />
    <div class="toast" role="status" :hidden="!toast" data-testid="preset-toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.presets { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-6) var(--s-7); max-width: 860px; }
.presets__head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--s-4); }
.presets__head p { margin: var(--s-2) 0 0; }
.presets__actions { display: flex; gap: var(--s-2); }
.presets__mine-note { margin: 0 0 var(--s-2); }
.presets__meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-4); }
.presets__meta p { margin: 0; }
.presets__toggle { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-md); font-size: 13px; cursor: pointer; }
.presets__toggle input { width: 18px; height: 18px; accent-color: var(--accent); }
.presets__card { padding: var(--s-5); display: grid; gap: var(--s-3); justify-items: start; }
.presets__card h2 { margin: 0; font-size: 16px; }
.presets__card p { margin: 0; }
.presets__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.presets__row { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); min-height: 64px; }
.presets__main { flex: 1; min-width: 0; display: grid; gap: var(--s-1); color: inherit; text-decoration: none; }
.presets__main:hover .presets__name { color: var(--accent-text); }
.presets__name { overflow-wrap: anywhere; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.presets__facts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); }
.presets__chip { height: 22px; font-size: 12px; }
.presets__rowActions { display: flex; align-items: center; gap: var(--s-1); flex-shrink: 0; }
.presets__menuWrap { position: relative; }
.presets__menu { position: absolute; right: 0; top: calc(100% + var(--s-1)); z-index: 40; min-width: 160px; padding: var(--s-1); display: grid; border-radius: var(--r-md); box-shadow: var(--shadow-md); }
.presets__menu button { min-height: var(--h-md); padding: 0 var(--s-3); border: 0; border-radius: var(--r-sm); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.presets__menu button:hover:not(:disabled) { background: var(--surface-2); }
.presets__menu button:disabled { opacity: .45; cursor: not-allowed; }
.presets__danger { color: var(--danger) !important; }
.presets__tabs { display: flex; justify-self: stretch; }
.presets__tab { flex: 1; display: flex; align-items: center; justify-content: center; height: var(--h-md); text-decoration: none; }
.presets__chip--public { background: var(--accent-tint); color: var(--accent-text); font-weight: 500; }
.presets__chip--strong { background: var(--border); color: var(--text); font-weight: 500; }
.presets__note { line-height: 1.5; }
.presets__more { justify-self: center; }
.presets__status:empty { display: none; }
.is-disabled { opacity: .45; pointer-events: none; }
@media (max-width: 760px) {
  .presets__actions { width: 100%; }
  .presets__actions .btn { flex: 1; height: var(--h-lg); }
}
</style>
