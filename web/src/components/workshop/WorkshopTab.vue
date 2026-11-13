<script setup lang="ts">
/**
 * 卡片頁的「工坊」分頁（ui.md §3.2、§4.1）：篩選（熱門｜最新｜已加入）＋建立擴充、已啟用提示條、格狀列表、分頁器。
 *
 * - 分頁要不要出現由卡片頁看伺服器的 tabVisible 決定；這裡只管分頁裡面。
 * - 作者暫停新增時上方一句說明、沒有「建立擴充」；原作者多一顆「管理擴充」，格上多狀態 chip。
 * - 篩選與頁碼記在網址（?ws=new|joined&wp=2），分享與返回都回到同一個位置。
 * - 讀不到時只在分頁裡說，不影響開始對話。
 * - 暫停時，已登入、不是原作者的人在說明右側多一顆「重新開放時通知我」（§3.9 ③）；登記後換成綠 chip＋取消登記。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ExtensionTile from "./ExtensionTile.vue";
import WorkshopIcon from "./WorkshopIcon.vue";
import UndoToast from "./UndoToast.vue";
import { confirmForm } from "@/lib/confirm";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { activeCount, isJoined, type CardWorkshopState } from "@/lib/card-workshop";
import { fetchCardWorkshop, fetchWorkshopsByIds, type CardWorkshopPage, type ExtensionSummary } from "@/lib/workshop";
import { cancelWorkshopInterest, knownInterest, registerWorkshopInterest, rememberInterest, type CardWorkshopPageWithInterest } from "@/lib/workshop-moderation";

const props = defineProps<{ cardId: string; cardNum: string; initial: CardWorkshopPage; initialFailed?: boolean; state: CardWorkshopState | null; joinBusy: string | null }>();
const emit = defineEmits<{ manage: []; join: [ExtensionSummary]; retry: [] }>();
const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();

type Filter = "hot" | "new" | "joined";
const FILTERS: Filter[] = ["hot", "new", "joined"];
const filter = computed<Filter>(() => (FILTERS.includes(route.query.ws as Filter) ? (route.query.ws as Filter) : "hot"));
const page = computed(() => Math.max(1, Math.floor(Number(route.query.wp) || 1)));
function go(next: { filter?: Filter; page?: number }) {
  const f = next.filter ?? filter.value;
  const p = next.page ?? 1;
  void router.replace({ query: { ...route.query, ws: f === "hot" ? undefined : f, wp: p > 1 ? String(p) : undefined } });
}

const data = ref<CardWorkshopPage>(props.initial);
const joinedList = ref<ExtensionSummary[]>([]);
const loading = ref(false);
const failed = ref(false);
let seq = 0;
async function load() {
  const n = ++seq;
  failed.value = false;
  if (filter.value === "joined") {
    loading.value = true;
    try {
      const ids = props.state?.selection?.items.map((i) => i.workshopId) ?? [];
      const token = session.me ? await session.accessToken() : null;
      const got = await fetchWorkshopsByIds(ids, token);
      if (n === seq) joinedList.value = ids.map((id) => got.items.find((x) => x.id === id)).filter((x): x is ExtensionSummary => !!x);
    } catch { if (n === seq) failed.value = true; } finally { if (n === seq) loading.value = false; }
    return;
  }
  if (filter.value === "hot" && page.value === 1 && n === 1) { data.value = props.initial; return; }
  loading.value = true;
  try {
    const token = session.me ? await session.accessToken() : null;
    const got = await fetchCardWorkshop(props.cardId, { sort: filter.value, page: page.value }, token);
    if (n === seq) data.value = got;
  } catch { if (n === seq) failed.value = true; } finally { if (n === seq) loading.value = false; }
}
// 「已加入」要等清單讀到：直接開 ?ws=joined 的連結時，分頁比清單先到
watch([filter, page, () => props.cardId, () => (filter.value === "joined" ? props.state?.selection?.items.map((i) => i.workshopId).join(",") : "")], load, { immediate: true });
watch(() => props.initial, (v) => { if (filter.value === "hot" && page.value === 1) data.value = v; });

const items = computed(() => (filter.value === "joined" ? joinedList.value : data.value.items));
const owner = computed(() => props.initial.viewerIsOwner);
const allowNew = computed(() => props.initial.allowNew);
const count = computed(() => (props.state ? activeCount(props.state) : 0));
const createTo = computed(() => ({ path: lp("/mine/workshops/new"), query: { card: props.cardNum } }));
const ownerTo = computed(() => lp(`/mine/cards/${encodeURIComponent(props.cardNum)}/workshop`));
// ── 重新開放時通知我 ──────────────────────────────────────────────
// 伺服器只在已登入、allowNew=false 時帶 viewerInterested；這次瀏覽裡登記過的以 lib 記的為準
// （分頁切走再切回來，卡片頁給的還是舊的 initial）
const canInterest = computed(() => !!session.me && !owner.value && !allowNew.value);
const interested = computed(() => {
  const me = session.me;
  if (!me) return false;
  return knownInterest(me.accountNumId, props.cardId) ?? !!(props.initial as CardWorkshopPageWithInterest).viewerInterested;
});
const interestBusy = ref(false);
const toast = ref<InstanceType<typeof UndoToast> | null>(null);
async function registerInterest() {
  if (interestBusy.value) return;
  const got = await confirmForm({
    title: t("workshop.interest.title"),
    message: t("workshop.interest.body"),
    confirmText: t("workshop.interest.submit"),
    cancelText: t("dialog.cancel"),
    focusCancel: true,
    field: { label: t("workshop.interest.field"), maxlength: 30 },
  });
  if (!got) return;
  await setInterest(true, got.text);
}
async function setInterest(on: boolean, draftName = "") {
  const me = session.me;
  if (!me || interestBusy.value) return;
  const cardId = props.cardId;
  interestBusy.value = true;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const got = on ? await registerWorkshopInterest(cardId, draftName, token) : await cancelWorkshopInterest(cardId, token);
    rememberInterest(me.accountNumId, cardId, got.interested);
    toast.value?.say(t(on ? "workshop.interest.toast.on" : "workshop.interest.toast.off"));
  } catch {
    toast.value?.say(t("workshop.interest.error"));
  } finally { interestBusy.value = false; }
}
const emptyKind = computed(() => (filter.value === "joined" ? "joined" : owner.value ? "owner" : "plain"));
</script>

<template>
  <section id="card-panel" class="ws-tab" role="tabpanel" aria-labelledby="card-tab-workshop">
    <div class="ws-tab__tools">
      <div class="seg" role="radiogroup" :aria-label="$t('workshop.tab.workshop')">
        <button v-for="f in FILTERS" :key="f" type="button" role="radio" class="seg__item" :class="{ 'seg__item--on': filter === f }" :aria-checked="filter === f" @click="go({ filter: f })">
          {{ $t(f === "hot" ? "workshop.filter.hot" : f === "new" ? "workshop.filter.new" : "workshop.filter.added") }}
        </button>
      </div>
      <span class="ws-tab__spacer" />
      <RouterLink v-if="owner" :to="ownerTo" class="btn btn--sm">{{ $t("workshop.owner.manage") }}</RouterLink>
      <RouterLink v-if="allowNew" :to="createTo" class="btn btn--sm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{{ $t("workshop.create") }}
      </RouterLink>
    </div>

    <div v-if="count && state?.status === 'ready'" class="ws-strip">
      <WorkshopIcon name="layers" />
      <span class="ws-strip__text">{{ $t("workshop.strip.active", { n: count }) }}</span>
      <button type="button" class="btn btn--sm" @click="emit('manage')">{{ $t("workshop.strip.manage") }}</button>
    </div>

    <div v-if="!allowNew" class="notice ws-tab__paused">
      <WorkshopIcon name="lock" /><span class="ws-tab__paused-text ws-text">{{ $t("workshop.paused.withExisting") }}</span>
      <span v-if="canInterest" class="ws-tab__interest">
        <template v-if="interested">
          <span class="chip ws-chip--ok" data-ws-interested>{{ $t("workshop.interest.registered") }}</span>
          <button type="button" class="btn btn--sm btn--ghost" data-ws-interest-off :disabled="interestBusy" @click="setInterest(false)">{{ $t("workshop.interest.cancel") }}</button>
        </template>
        <button v-else type="button" class="btn btn--sm" data-ws-interest :disabled="interestBusy" @click="registerInterest">{{ $t("workshop.interest.button") }}</button>
      </span>
    </div>

    <p v-if="failed || (initialFailed && filter !== 'joined')" class="notice notice--error ws-tab__error" role="alert">
      {{ $t("workshop.error.load") }}
      <button type="button" class="btn btn--sm" @click="failed ? load() : emit('retry')">{{ $t("library.retry") }}</button>
    </p>
    <div v-else-if="loading && !items.length" class="ws-grid" aria-busy="true">
      <div v-for="i in 6" :key="i" class="ghost ws-tab__ghost" />
    </div>
    <div v-else-if="!items.length" class="ws-tab__empty">
      <span class="ws-tab__mono" aria-hidden="true"><WorkshopIcon name="layers" /></span>
      <template v-if="emptyKind === 'joined'">
        <h3>{{ $t("workshop.empty.added.title") }}</h3>
        <p class="ws-text">{{ $t("workshop.empty.added.body") }}</p>
        <button type="button" class="btn" @click="go({ filter: 'hot' })">{{ $t("workshop.empty.added.cta") }}</button>
      </template>
      <template v-else-if="emptyKind === 'owner'">
        <h3>{{ $t("workshop.empty.owner.title") }}</h3>
        <p class="ws-text">{{ $t("workshop.empty.owner.body") }}</p>
        <RouterLink v-if="allowNew" :to="createTo" class="btn">{{ $t("workshop.create") }}</RouterLink>
      </template>
      <template v-else>
        <h3>{{ $t("workshop.empty.title") }}</h3>
        <p class="ws-text">{{ $t("workshop.empty.body") }}</p>
        <RouterLink v-if="allowNew" :to="createTo" class="btn">{{ $t("workshop.empty.cta") }}</RouterLink>
      </template>
    </div>
    <template v-else>
      <div class="ws-grid" :aria-busy="loading || undefined">
        <ExtensionTile v-for="ext in items" :key="ext.id" :ext="ext" :joined="state?.selection ? isJoined(state, ext.id) : !!ext.joined" :busy="joinBusy === ext.id" :owner-view="owner" @join="emit('join', $event)" />
      </div>
      <nav v-if="filter !== 'joined' && (page > 1 || data.hasMore)" class="pager" :aria-label="$t('workshop.tab.workshop')">
        <button type="button" class="btn btn--sm" :disabled="page <= 1" @click="go({ page: page - 1 })">‹</button>
        <span class="subtle">{{ page }}</span>
        <button type="button" class="btn btn--sm" :disabled="!data.hasMore" @click="go({ page: page + 1 })">›</button>
      </nav>
    </template>
    <UndoToast ref="toast" />
  </section>
</template>

<style scoped>
.ws-tab { display: grid; gap: var(--s-4); min-width: 0; padding-bottom: var(--s-6); }
.ws-tab__tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.ws-tab__spacer { flex: 1; }
.ws-tab__tools .btn svg { width: 16px; height: 16px; }
.ws-tab__paused { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin: 0; }
.ws-tab__paused-text { flex: 1 1 12em; min-width: 0; }
/* 放不下時整組換到下一行靠右，按鈕不被擠扁 */
.ws-tab__interest { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--s-2); margin-inline-start: auto; }
.ws-tab__paused svg { width: 16px; height: 16px; flex: none; }
.ws-tab__error { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin: 0; }
.ws-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-4); }
.ws-tab__ghost { height: 250px; border-radius: var(--r-md); }
.ws-tab__empty { display: grid; justify-items: center; gap: var(--s-2); padding: var(--s-7) var(--s-4); text-align: center; }
.ws-tab__empty h3 { margin: var(--s-2) 0 0; font-size: 15px; }
.ws-tab__empty p { margin: 0 0 var(--s-2); max-width: 34em; font-size: 13.5px; color: var(--text-2); }
.ws-tab__mono { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--accent-tint); color: var(--accent-text); }
.ws-tab__mono svg { width: 26px; height: 26px; }
.ws-tab .pager { display: flex; align-items: center; justify-content: center; gap: var(--s-3); }
@media (max-width: 1000px) { .ws-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .ws-grid { grid-template-columns: minmax(0, 1fr); gap: var(--s-3); } .ws-tab__ghost { height: 110px; } }
@media (max-width: 820px) { .ws-tab { padding-bottom: 96px; } }
</style>
