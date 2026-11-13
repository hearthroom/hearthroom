<script setup lang="ts">
/**
 * 原作者管理別人為自己的卡建立的擴充（ui.md §3.8、§4.7b）。窄頁 720。
 *
 *   回卡片編輯 → 「管理擴充」→ 為《卡名》建立的擴充（N）→ 一則說明 → 列表。
 *
 * 每列的動作都是次要按鈕，這頁沒有主行動：退回與隱藏都可逆，用一般確認框加必填理由（理由會原文送給製作者），
 * 不用打字確認。動作成功後列上留下狀態與理由（持久落點），toast 只是附帶的回饋。
 * 「查看」連公開詳情頁，不讀擴充的完整內容（Q14 尚未裁定前不開唯讀全文）。
 * 網址上的 cardId 是本站卡號；開關與動作在 Provider，用讀卡拿到的角色 id 去問。
 */
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import ExtensionCover from "@/components/workshop/ExtensionCover.vue";
import UndoToast from "@/components/workshop/UndoToast.vue";
import { ApiError, fetchCard } from "@/lib/api";
import { confirmForm } from "@/lib/confirm";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchPolicy, ownerAction, type ExtensionSummary } from "@/lib/workshop";

const route = useRoute();
const session = useSession();
const { lp } = useLocalePath();
const { t, locale } = useI18n();

const cardId = computed(() => String(route.params.cardId ?? ""));
const cardName = ref("");
const roleId = ref("");
const items = ref<ExtensionSummary[]>([]);
const loading = ref(true);
const failed = ref(false);
const forbidden = ref(false);
const loaded = ref(false);
const actionError = ref("");
const busy = ref<string | null>(null);
const toast = ref<InstanceType<typeof UndoToast> | null>(null);

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
  forbidden.value = false;
  try {
    if (!roleId.value) {
      const card = await fetchCard(cardId.value, locale.value, { quiet: true });
      if (n !== seq) return;
      cardName.value = card.name;
      // 跟卡片編輯頁同一個角色 id：同步來的卡以來源角色為準
      roleId.value = card.sourceRoleId ?? card.roleId;
    }
    const got = await fetchPolicy(roleId.value, await token());
    if (n !== seq) return;
    items.value = got.items;
    loaded.value = true;
  } catch (err) {
    if (n !== seq) return;
    if (err instanceof ApiError && err.status === 403) forbidden.value = true;
    else failed.value = true;
  } finally {
    if (n === seq) loading.value = false;
  }
}
watch(cardId, () => { roleId.value = ""; cardName.value = ""; items.value = []; loaded.value = false; });
watch([cardId, () => session.me?.accountNumId], ([id, me]) => { if (id && me) void load(); }, { immediate: true });

const backTo = computed(() => lp(`/cards/${encodeURIComponent(cardId.value)}/edit`));
const viewTo = (ext: ExtensionSummary) => lp(`/workshops/${encodeURIComponent(ext.id)}`);
const displayName = (ext: ExtensionSummary) => ext.name.trim() || t("workshop.mine.row.untitled");
const meta = (ext: ExtensionSummary) => ext.version > 0
  ? t("workshop.owner.row.meta", { by: ext.author.name, count: compact(ext.joinCount), ver: `v${ext.version}` })
  : `${ext.author.name} · ${t("workshop.card.installs", { count: compact(ext.joinCount) })}`;
const stateOf = (ext: ExtensionSummary) => ext.ownerState ?? "visible";

async function act(ext: ExtensionSummary, action: "return" | "hide" | "restore") {
  actionError.value = "";
  let reason = "";
  if (action !== "restore") {
    const name = displayName(ext);
    const answer = await confirmForm({
      title: t(action === "return" ? "workshop.owner.return.title" : "workshop.owner.hide.title", { name }),
      message: t(action === "return" ? "workshop.owner.return.body" : "workshop.owner.hide.body"),
      confirmText: t(action === "return" ? "workshop.owner.manage.return" : "workshop.owner.manage.hide"),
      focusCancel: true, phraseWrap: true,
      field: { label: t("workshop.owner.reason.label"), required: true, multiline: true, maxlength: 200 },
    });
    if (!answer?.text.trim()) return;
    reason = answer.text.trim();
  }
  const before = stateOf(ext);
  busy.value = ext.id;
  try {
    const got = await ownerAction(ext.id, action, reason, await token());
    ext.ownerState = got.ownerState;
    ext.ownerReason = got.ownerReason;
    toast.value?.say(t(action === "return" ? "workshop.owner.toast.returned" : action === "hide" ? "workshop.owner.toast.hidden"
      : before === "returned" ? "workshop.owner.toast.undoReturn" : "workshop.owner.toast.unhide"));
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : t("state.actionFailed");
    // 別人（或另一個分頁）剛改過這一列：重讀，畫面照現況
    if (err instanceof ApiError && err.code === "owner_action_stale") await load();
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="page ws-mgr">
    <RouterLink :to="backTo" class="ws-mgr__back link">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg>{{ $t("workshop.owner.manage.back") }}
    </RouterLink>
    <h1 class="display ws-mgr__title">{{ $t("workshop.owner.manage.title") }}</h1>

    <div v-if="forbidden" class="notice notice--error" role="alert" data-ws-forbidden>
      <span class="ws-text">{{ $t("workshop.owner.manage.forbidden") }}</span>
    </div>

    <template v-else>
      <p v-if="cardName && loaded" class="muted ws-mgr__sub">{{ $t("workshop.owner.manage.sub", { card: cardName, n: items.length }) }}</p>
      <p class="notice ws-text">{{ $t("workshop.owner.manage.intro") }}</p>
      <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

      <div v-if="loading && !loaded" class="ws-mgr__list" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ghost ws-mgr__ghost" />
      </div>
      <div v-else-if="failed && !loaded" class="notice notice--error ws-mgr__error" role="alert">
        <span class="ws-text">{{ $t("workshop.mine.error.load") }}</span>
        <button type="button" class="btn btn--sm" :disabled="loading" @click="load">{{ $t("library.retry") }}</button>
      </div>
      <div v-else-if="!items.length" class="empty panel">
        <p class="empty__title ws-text">{{ $t("workshop.empty.owner.title") }}</p>
        <p class="empty__body ws-text">{{ $t("workshop.owner.manage.empty") }}</p>
      </div>

      <ul v-else class="ws-mgr__list" :aria-busy="loading || undefined">
        <li v-for="ext in items" :key="ext.id" class="panel ws-mgr__row" :data-ws-owned="ext.id">
          <ExtensionCover class="ws-mgr__cover" :src="ext.coverUrl" :name="displayName(ext)" :adult="ext.adult" />
          <div class="ws-mgr__body">
            <h2 class="ws-mgr__name">{{ displayName(ext) }}</h2>
            <p class="subtle">{{ meta(ext) }}</p>
            <p class="ws-mgr__chips">
              <span v-if="stateOf(ext) === 'returned'" class="chip ws-chip--bad" data-ws-state>{{ $t("workshop.badge.returned") }}</span>
              <span v-else-if="stateOf(ext) === 'hidden'" class="chip ws-chip--warn" data-ws-state>{{ $t("workshop.badge.hidden") }}</span>
              <span v-else class="chip ws-chip--ok" data-ws-state>{{ $t("workshop.status.published") }}</span>
              <span v-if="ext.appeal === 'pending'" class="chip ws-chip--warn">{{ $t("workshop.owner.manage.appeal") }}</span>
            </p>
            <p v-if="stateOf(ext) !== 'visible' && ext.ownerReason" class="ws-reason" data-ws-reason>{{ $t("workshop.owner.manage.reason", { reason: ext.ownerReason }) }}</p>
          </div>
          <div class="ws-mgr__actions">
            <template v-if="stateOf(ext) === 'returned'">
              <span class="subtle ws-text">{{ $t("workshop.owner.manage.waiting") }}</span>
              <button type="button" class="btn btn--sm" :disabled="busy === ext.id" data-ws-act="restore" @click="act(ext, 'restore')">{{ $t("workshop.owner.manage.undoReturn") }}</button>
            </template>
            <button v-else-if="stateOf(ext) === 'hidden'" type="button" class="btn btn--sm" :disabled="busy === ext.id" data-ws-act="restore" @click="act(ext, 'restore')">{{ $t("workshop.owner.manage.unhide") }}</button>
            <template v-else>
              <RouterLink :to="viewTo(ext)" class="btn btn--sm">{{ $t("workshop.owner.manage.view") }}</RouterLink>
              <button type="button" class="btn btn--sm" :disabled="busy === ext.id" data-ws-act="return" @click="act(ext, 'return')">{{ $t("workshop.owner.manage.return") }}</button>
              <button type="button" class="btn btn--sm" :disabled="busy === ext.id" data-ws-act="hide" @click="act(ext, 'hide')">{{ $t("workshop.owner.manage.hide") }}</button>
            </template>
          </div>
        </li>
      </ul>
    </template>

    <UndoToast ref="toast" />
  </div>
</template>

<style scoped>
.ws-mgr { max-width: 720px; display: grid; gap: var(--s-4); align-content: start; }
.ws-mgr__back { display: inline-flex; align-items: center; gap: 4px; justify-self: start; font-size: 13.5px; color: var(--text-2); }
.ws-mgr__back svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.ws-mgr__title { margin: 0; font-size: clamp(20px, 2.6vw, 24px); }
.ws-mgr__sub { margin: calc(-1 * var(--s-2)) 0 0; font-size: 14px; }
.ws-mgr__list { display: grid; gap: var(--s-3); margin: 0; padding: 0; list-style: none; }
.ws-mgr__ghost { height: 120px; border-radius: var(--r-lg); }
.ws-mgr__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.ws-mgr__row { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: var(--s-3) var(--s-4); padding: var(--s-3); }
.ws-mgr__cover { width: 128px; border-radius: var(--r-md); }
.ws-mgr__body { display: grid; gap: 6px; min-width: 0; align-content: start; }
.ws-mgr__body p { margin: 0; }
.ws-mgr__name { margin: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-mgr__chips { display: flex; flex-wrap: wrap; gap: var(--s-1); }
/* 動作列整列寬、靠右；手機上按鈕放不下就換行 */
.ws-mgr__actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--s-2); }
.ws-mgr__actions .subtle { margin-inline-end: auto; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-3); justify-items: center; }
.empty__title { margin: 0; font-size: 16px; font-weight: 600; }
.empty__body { margin: 0; max-width: 34em; font-size: 14px; color: var(--text-2); }
@media (max-width: 760px) {
  .ws-mgr__row { grid-template-columns: 96px minmax(0, 1fr); gap: var(--s-3); }
  .ws-mgr__cover { width: 96px; }
}
</style>
