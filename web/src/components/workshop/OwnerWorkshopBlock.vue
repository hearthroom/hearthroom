<script setup lang="ts">
import { stageAvailable } from "@stage-site";
/**
 * 卡片編輯頁「發布」分區裡原作者的工坊塊（docs studio/tasks/2026-11-15-workshop-v2-dlc-and-lorebook/ui.md §3.1）。
 *
 *   標題「工坊」＋開關 → 一句說明 → 開啟時：作者 DLC 與玩家擴充兩列摘要、「建立 DLC」「前往工坊頁」
 *   → 關閉但還有內容時：一條「內容保留，重新開啟就恢復」。
 *
 * 預設關閉。開啟可逆、沒有後果，按了直接存；關閉只在有受影響的內容（已發布的 DLC、玩家擴充或有人加入）時
 * 先跳確認框（焦點在取消），沒有就直接存。
 * 開關以伺服器回的為準：儲存中停用、不樂觀翻轉；存失敗就重讀一次，畫面照伺服器現況。
 * 不是原作者（403）時整塊不出現。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchPolicy, savePolicy, type OwnerPolicy, type OwnerPolicyCounts } from "@/lib/workshop";

const props = defineProps<{ roleId: string; cardId?: string }>();
const { t, locale } = useI18n();
const session = useSession();
const { lp } = useLocalePath();

const policy = ref<OwnerPolicy | null>(null);
const loading = ref(false);
const failed = ref(false);
const notOwner = ref(false);
const saving = ref(false);
const saveFailed = ref(false);
/** 存失敗的那一次想要的值：重試照它再送一次；重讀發現伺服器其實已經是它，就當成功 */
let failedTarget: boolean | null = null;

const open = computed(() => !!policy.value?.allowNew);
/** 舊回應沒有 counts：用列表裡看得到的已發布項目估 */
const counts = computed<OwnerPolicyCounts>(() => {
  const p = policy.value;
  if (p?.counts) return p.counts;
  const items = p?.items ?? [];
  const live = items.filter((i) => i.version > 0);
  return {
    dlcPublished: live.filter((i) => i.kind === "dlc").length,
    dlcDrafts: items.filter((i) => i.kind === "dlc" && i.version === 0).length,
    lorebookPublished: live.filter((i) => i.kind !== "dlc").length,
    lorebookDrafts: 0,
    joinCount: live.reduce((n, i) => n + (i.joinCount || 0), 0),
  };
});
const dlcAll = computed(() => counts.value.dlcPublished + counts.value.dlcDrafts);
const dlcSummary = computed(() => dlcAll.value
  ? t("workshop.owner.dlc.summary", { published: counts.value.dlcPublished, draft: counts.value.dlcDrafts })
  : t("workshop.owner.dlc.empty"));
const extSummary = computed(() => counts.value.lorebookPublished
  ? t("workshop.owner.ext.summary", { n: counts.value.lorebookPublished, joins: compact(counts.value.joinCount) }, counts.value.lorebookPublished)
  : t("workshop.owner.ext.empty"));
/** 關閉會影響到誰：有已發布的內容或有人加入 */
const affected = computed(() => counts.value.dlcPublished + counts.value.lorebookPublished + counts.value.joinCount > 0);
const keptNote = computed(() => !open.value && counts.value.dlcPublished + counts.value.lorebookPublished > 0);

/** 存開關與建立 DLC 用的卡：有卡號用卡號；卡還沒有本站卡號（私卡、用角色 id 開的編輯頁）就用角色 id，伺服器向 Provider 認原作者 */
const cardRef = computed(() => props.cardId || props.roleId);
const createTo = computed(() => (cardRef.value ? lp(`/mine/workshops/new?card=${encodeURIComponent(cardRef.value)}`) : ""));
const tabTo = computed(() => (props.cardId ? lp(`/cards/${encodeURIComponent(props.cardId)}?tab=workshop`) : ""));

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

async function save(next: boolean, confirmed = false) {
  const current = policy.value;
  if (!current || saving.value || !cardRef.value) return;
  if (!next && affected.value && !confirmed) {
    const ext = counts.value.lorebookPublished;
    const ok = await confirmDialog({
      title: t("workshop.owner.closeConfirm.title"),
      // 兩句接成同一段：中日文句號後不留空格，英韓文留一個（確認框不換行，\n 會變成多出來的空格）
      message: [t("workshop.owner.closeConfirm.body", { dlc: counts.value.dlcPublished, ext }, ext), t("workshop.owner.closeConfirm.keep")].join(/^(zh|ja)/.test(String(locale.value)) ? "" : " "),
      confirmText: t("workshop.owner.closeConfirm.confirm"), cancelText: t("dialog.cancel"), focusCancel: true, phraseWrap: true,
    });
    if (!ok) return;
  }
  saving.value = true;
  saveFailed.value = false;
  failedTarget = null;
  try {
    policy.value = await savePolicy(cardRef.value, next, current.revision, await token());
  } catch {
    await load();
    // 回應掉了但其實存進去了：畫面照伺服器，不留錯誤，也不讓重試翻回去
    if (policy.value?.allowNew !== next) { failedTarget = next; saveFailed.value = true; }
  } finally {
    saving.value = false;
  }
}
/** 重試送的是上次想要的值（已經確認過，不再問一次），不是「目前狀態的相反」 */
function retry() { if (failedTarget !== null) void save(failedTarget, true); }
</script>

<template>
  <section v-if="!notOwner && (policy || loading || failed)" class="panel ws-owner" data-ws-owner>
    <div class="ws-owner__head">
      <h2 id="ws-owner-title">{{ $t("workshop.tab.workshop") }}</h2>
      <button
        v-if="policy" type="button" class="ws-switch" role="switch" :aria-checked="open" :aria-label="$t('workshop.owner.switch.label')"
        :disabled="saving" data-ws-owner-switch @click="save(!open)"
      />
    </div>

    <div v-if="!policy && loading" class="ghost ws-owner__ghost" aria-hidden="true" />
    <div v-else-if="!policy && failed" class="notice notice--error ws-owner__error" role="alert">
      <span class="ws-text">{{ $t("workshop.owner.error.load") }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>

    <template v-else-if="policy">
      <p class="muted ws-text ws-owner__desc">{{ $t("workshop.owner.switch.desc") }}</p>
      <RouterLink v-if="cardRef" :to="{ path: lp('/mine'), query: { tab: 'workshop-management', card: cardRef } }" class="btn btn--sm ws-owner__go">
        {{ $t("workshop.tab.ownerBanner.action") }}
      </RouterLink>
      <div v-if="saveFailed" class="notice notice--error ws-owner__error" role="alert" data-ws-owner-error>
        <span class="ws-text">{{ $t("workshop.owner.error.save") }}</span>
        <button type="button" class="btn btn--sm" :disabled="saving" @click="retry">{{ $t("library.retry") }}</button>
      </div>
      <p v-if="keptNote" class="notice ws-text" data-ws-owner-kept>
        {{ $t("workshop.owner.offKeptNote", { dlc: counts.dlcPublished, ext: counts.lorebookPublished }, counts.lorebookPublished) }}
      </p>

      <div v-if="open" class="ws-owner__layers" data-ws-owner-layers>
        <div class="ws-owner__layer" data-ws-owner-dlc>
          <span class="ws-owner__text">
            <strong>{{ $t("workshop.layer.dlc") }}</strong>
            <span class="subtle ws-text">{{ dlcSummary }}</span>
          </span>
          <RouterLink v-if="stageAvailable && createTo" :to="createTo" class="btn btn--sm" data-ws-owner-create>{{ $t("workshop.owner.dlc.create") }}</RouterLink>
        </div>
        <div class="ws-owner__layer" data-ws-owner-ext>
          <span class="ws-owner__text">
            <strong>{{ $t("workshop.layer.ext") }}</strong>
            <span class="subtle ws-text">{{ extSummary }}</span>
          </span>
        </div>
        <RouterLink v-if="tabTo" :to="tabTo" class="btn btn--sm btn--ghost ws-owner__go" data-ws-owner-go>{{ $t("workshop.owner.goTab") }}</RouterLink>
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
.ws-owner__error > span { flex: 1 1 200px; min-width: 0; }
.ws-owner__layers { display: grid; gap: var(--s-2); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.ws-owner__layer { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--surface-2); min-height: var(--h-lg); }
.ws-owner__text { display: grid; gap: 2px; min-width: 0; }
.ws-owner__text strong { font-size: 14px; }
.ws-owner__layer .btn { flex: none; }
.ws-owner__go { justify-self: start; }
</style>
