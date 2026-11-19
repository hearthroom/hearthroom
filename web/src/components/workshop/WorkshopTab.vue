<script setup lang="ts">
import { stageAvailable } from "@stage-site";
/**
 * 卡片頁的「工坊」分頁（docs studio/tasks/2026-11-15-workshop-v2-dlc-and-lorebook/ui.md §3.2）：
 * 篩選（熱門｜最新｜已加入）、已啟用提示條，下面兩區上下排：作者 DLC 在上、玩家擴充在下，分頁器。
 *
 * - 分頁只在原卡作者開啟工坊時出現（卡片頁看伺服器的 tabVisible）；這裡只管分頁裡面。
 * - 玩家看：有 DLC 才出現 DLC 區；玩家擴充區一直在，有「建立擴充」，沒有內容時空態＋「建立第一個擴充」。
 * - 原作者看：DLC 區一直在，標題旁「建立 DLC」，沒有時空態＋唯一入口；玩家擴充區沒有建立入口，
 *   每格多「隱藏」（新玩家看不到也不能加入，已加入的照常；沒有理由、不通知製作者），隱藏的換「取消隱藏」。
 * - 兩區由同一頁結果依 kind 分開；篩選與頁碼記在網址（?ws=new|joined&wp=2），分享與返回都回到同一個位置。
 * - 讀不到時只在分頁裡說，不影響開始對話。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ExtensionTile from "./ExtensionTile.vue";
import WorkshopIcon from "./WorkshopIcon.vue";
import UndoToast from "./UndoToast.vue";
import { confirmDialog } from "@/lib/confirm";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { activeCount, isJoined, type CardWorkshopState } from "@/lib/card-workshop";
import { fetchCardWorkshop, fetchWorkshopsByIds, ownerAction, type CardWorkshopPage, type ExtensionSummary } from "@/lib/workshop";

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
const dlcItems = computed(() => items.value.filter((i) => i.kind === "dlc"));
const extItems = computed(() => items.value.filter((i) => i.kind !== "dlc"));
const owner = computed(() => props.initial.viewerIsOwner);
const joinedView = computed(() => filter.value === "joined");
const count = computed(() => (props.state ? activeCount(props.state) : 0));
const createTo = computed(() => ({ path: lp("/mine/workshops/new"), query: { card: props.cardNum } }));
/** 原作者在自己的卡上只做 DLC；玩家只做玩家擴充。建立入口照身分放在對應的區 */
const showDlc = computed(() => (owner.value && !joinedView.value) || dlcItems.value.length > 0);
const showExt = computed(() => !joinedView.value || extItems.value.length > 0 || !dlcItems.value.length);
const joinedEmpty = computed(() => joinedView.value && !items.value.length);

// ── 原作者隱藏玩家擴充 ─────────────────────────────────────────────
const toast = ref<InstanceType<typeof UndoToast> | null>(null);
const hideBusy = ref<string | null>(null);
async function setHidden(ext: ExtensionSummary, hide: boolean) {
  if (hideBusy.value) return;
  if (hide) {
    const ok = await confirmDialog({
      title: t("workshop.hide.title", { name: ext.name }), message: t("workshop.hide.body"),
      confirmText: t("workshop.hide.confirm"), cancelText: t("dialog.cancel"), focusCancel: true, phraseWrap: true,
    });
    if (!ok) return;
  }
  hideBusy.value = ext.id;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const got = await ownerAction(ext.id, hide ? "hide" : "restore", token);
    ext.ownerState = got.ownerState ?? (hide ? "hidden" : "visible");
    toast.value?.say(t(hide ? "workshop.hide.toast" : "workshop.unhide.toast", { name: ext.name }));
  } catch (err) {
    toast.value?.say(err instanceof Error && err.message ? err.message : t("state.actionFailed"));
  } finally { hideBusy.value = null; }
}
const joinedOf = (ext: ExtensionSummary) => (props.state?.selection ? isJoined(props.state, ext.id) : !!ext.joined);
</script>

<template>
  <section id="card-panel" class="ws-tab" role="tabpanel" aria-labelledby="card-tab-workshop">
    <div class="ws-tab__tools">
      <div class="seg" role="radiogroup" :aria-label="$t('workshop.tab.workshop')">
        <button v-for="f in FILTERS" :key="f" type="button" role="radio" class="seg__item" :class="{ 'seg__item--on': filter === f }" :aria-checked="filter === f" @click="go({ filter: f })">
          {{ $t(f === "hot" ? "workshop.filter.hot" : f === "new" ? "workshop.filter.new" : "workshop.filter.added") }}
        </button>
      </div>
    </div>

    <div v-if="count && state?.status === 'ready'" class="ws-strip">
      <WorkshopIcon name="layers" />
      <span class="ws-strip__text">{{ $t("workshop.strip.active", { n: count }) }}</span>
      <button type="button" class="btn btn--sm" @click="emit('manage')">{{ $t("workshop.strip.manage") }}</button>
    </div>

    <p v-if="failed || (initialFailed && !joinedView)" class="notice notice--error ws-tab__error" role="alert">
      {{ $t("workshop.error.load") }}
      <button type="button" class="btn btn--sm" @click="failed ? load() : emit('retry')">{{ $t("library.retry") }}</button>
    </p>
    <div v-else-if="loading && !items.length" class="ws-grid" aria-busy="true">
      <div v-for="i in 6" :key="i" class="ghost ws-tab__ghost" />
    </div>
    <div v-else-if="joinedEmpty" class="ws-tab__empty">
      <span class="ws-tab__mono" aria-hidden="true"><WorkshopIcon name="layers" /></span>
      <h3>{{ $t("workshop.empty.added.title") }}</h3>
      <p class="ws-text">{{ $t("workshop.empty.added.body") }}</p>
      <button type="button" class="btn" @click="go({ filter: 'hot' })">{{ $t("workshop.empty.added.cta") }}</button>
    </div>
    <template v-else>
      <section v-if="showDlc" class="ws-sect" aria-labelledby="ws-sect-dlc" data-ws-sect="dlc">
        <div class="ws-sect__head">
          <h2 id="ws-sect-dlc">{{ $t("workshop.layer.dlc") }}</h2>
          <RouterLink v-if="stageAvailable && owner && dlcItems.length" :to="createTo" class="btn btn--sm" data-ws-create-dlc>{{ $t("workshop.owner.dlc.create") }}</RouterLink>
        </div>
        <div v-if="dlcItems.length" class="ws-grid" :aria-busy="loading || undefined">
          <ExtensionTile v-for="ext in dlcItems" :key="ext.id" :ext="ext" :joined="joinedOf(ext)" :busy="joinBusy === ext.id" @join="emit('join', $event)" />
        </div>
        <div v-else class="panel ws-sect__empty" data-ws-empty="dlc">
          <p class="muted ws-text">{{ $t("workshop.dlc.empty") }}</p>
          <RouterLink v-if="stageAvailable" :to="createTo" class="btn btn--sm">{{ $t("workshop.dlc.empty.cta") }}</RouterLink>
        </div>
      </section>

      <section v-if="showExt" class="ws-sect" aria-labelledby="ws-sect-ext" data-ws-sect="ext">
        <div class="ws-sect__head">
          <h2 id="ws-sect-ext">{{ $t("workshop.layer.ext") }}</h2>
          <RouterLink v-if="stageAvailable && !owner && extItems.length" :to="createTo" class="btn btn--sm" data-ws-create-ext>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{{ $t("workshop.create") }}
          </RouterLink>
        </div>
        <div v-if="extItems.length" class="ws-grid" :aria-busy="loading || undefined">
          <ExtensionTile
            v-for="ext in extItems" :key="ext.id" :ext="ext" :joined="joinedOf(ext)" :busy="joinBusy === ext.id || hideBusy === ext.id" :can-hide="owner"
            @join="emit('join', $event)" @hide="setHidden($event, true)" @unhide="setHidden($event, false)"
          />
        </div>
        <div v-else class="panel ws-sect__empty" data-ws-empty="ext">
          <p class="muted ws-text">{{ $t("workshop.ext.empty") }}</p>
          <RouterLink v-if="stageAvailable && !owner" :to="createTo" class="btn btn--sm">{{ $t("workshop.empty.cta") }}</RouterLink>
        </div>
      </section>

      <nav v-if="!joinedView && (page > 1 || data.hasMore)" class="pager" :aria-label="$t('workshop.tab.workshop')">
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
.ws-sect { display: grid; gap: var(--s-3); min-width: 0; }
.ws-sect__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); min-height: var(--h-sm); }
.ws-sect__head h2 { margin: 0; font-size: 16px; font-weight: 600; }
.ws-sect__head .btn svg { width: 16px; height: 16px; }
.ws-sect__empty { display: grid; justify-items: start; gap: var(--s-2); padding: var(--s-4); }
.ws-sect__empty p { margin: 0; font-size: 13.5px; }
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
@media (max-width: 480px) { .ws-tab__tools .seg__item { padding: 0 10px; } }
@media (max-width: 820px) { .ws-tab { padding-bottom: 96px; } }
</style>
