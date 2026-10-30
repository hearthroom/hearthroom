<script setup lang="ts">
/**
 * 預設庫（PM 2026-10-30 資訊架構）：社群預設唯一的瀏覽處。
 *
 * 上面一排篩選（全部／通用／選一個系列或模型，跟「測試過的模型」同一個兩層選單）同時管下面兩區：
 * 「熱門」最多 12 份（上游算熱度；有熱度的不夠時用最新公開的補滿、標新上架），
 * 「全部預設」可切熱門／最新、可搜尋、往下載入更多。網頁沒有「目前的模型」，篩選預設是「全部」。
 *
 * 篩選、排序、搜尋都放在網址上：重新整理、上一頁回來、分享連結都還是同一組條件。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { pageTitle } from "@/lib/i18n";
import { whole } from "@/lib/format";
import { favoritePreset, LIBRARY_PAGE, listPresetLibrary, listPresetLibraryHot, type LibrarySort, type PresetLibraryItem } from "@/lib/presets";
import { usePresetAccess } from "@/lib/use-preset-access";
import { useLocalePath } from "@/lib/use-locale";
import PresetLibraryRow from "@/components/preset/PresetLibraryRow.vue";
import PresetModelPicker from "@/components/preset/PresetModelPicker.vue";
import PresetReauth from "@/components/preset/PresetReauth.vue";
import PresetTabs from "@/components/preset/PresetTabs.vue";
import { authorLabel, useModelCatalog } from "@/components/preset/preset-share";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { token, needsConsent, consentNeeded, reauthorize } = usePresetAccess();
const catalog = useModelCatalog(token);

const model = computed(() => (typeof route.query.model === "string" && route.query.model ? route.query.model : "all"));
const sort = computed<LibrarySort>(() => (route.query.sort === "new" ? "new" : "hot"));
const q = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const typed = ref(q.value);
/** 選單是單選：v-model 給它一個值的陣列；拿掉那個值就回到「全部」。值照原字送上游（series:／model:，舊連結裡的線路代號也收） */
const picked = computed({
  get: () => (model.value === "all" || model.value === "general" ? [] : [model.value]),
  set: (v: string[]) => setQuery({ model: v[0] ?? "all" }),
});

const hot = ref<PresetLibraryItem[]>([]);
const hotLoading = ref(true);
const items = ref<PresetLibraryItem[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const failed = ref(false);
const hasMore = ref(false);
const busy = ref("");
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let hotSeq = 0;
let listSeq = 0;

function say(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 4000);
}

/** 熱門區讀不到不擋整頁：收起來，下面的列表照常 */
async function loadHot() {
  const mine = ++hotSeq;
  hotLoading.value = true;
  try {
    const page = await listPresetLibraryHot(await token(), model.value);
    if (mine === hotSeq) hot.value = page.items;
  } catch (err) {
    if (mine === hotSeq) { hot.value = []; consentNeeded(err); }
  } finally {
    if (mine === hotSeq) hotLoading.value = false;
  }
}

async function load(more = false) {
  const mine = ++listSeq;
  if (more) loadingMore.value = true;
  else { loading.value = true; failed.value = false; }
  try {
    const page = await listPresetLibrary(await token(), { model: model.value, q: q.value, sort: sort.value, offset: more ? items.value.length : 0 });
    if (mine !== listSeq) return;
    items.value = more ? [...items.value, ...page.items] : page.items;
    hasMore.value = page.items.length >= LIBRARY_PAGE;
  } catch (err) {
    if (mine !== listSeq) return;
    if (consentNeeded(err)) return;
    if (!more) failed.value = true;
    else say(t("preset.share.error.load"));
  } finally {
    if (mine === listSeq) { loading.value = false; loadingMore.value = false; }
  }
}

function setQuery(next: { model?: string; q?: string; sort?: LibrarySort }) {
  const query = { ...route.query, ...next };
  if (!query.model || query.model === "all") delete query.model;
  if (!query.q) delete query.q;
  if (query.sort !== "new") delete query.sort;
  void router.replace({ query });
}

/** 打字停一下才搜，不是每個字都打一次上游 */
let timer: ReturnType<typeof setTimeout> | undefined;
watch(typed, (v) => { clearTimeout(timer); timer = setTimeout(() => setQuery({ q: v.trim().slice(0, 64) }), 300); });
// 熱門只看篩選；全部預設看篩選、排序與搜尋
watch(model, () => void loadHot(), { immediate: true });
watch([model, q, sort], () => void load(), { immediate: true });

async function toggle(item: PresetLibraryItem) {
  busy.value = item.presetId;
  try {
    const res = await favoritePreset(await token(), item.presetId, !item.favorited);
    item.favorited = res.favorited;
    say(t(res.favorited ? "preset.share.fav.added" : "preset.share.fav.removed"));
  } catch (err) {
    if (!consentNeeded(err)) say(t("preset.share.error.fav"));
  } finally {
    busy.value = "";
  }
}

const hotStats = (i: PresetLibraryItem) => t("preset.share.hot.stats", { n: whole(i.usesLast7d), m: whole(i.favoriteCount ?? 0) });

onMounted(() => { document.title = pageTitle(t("preset.share.library.name")); });
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(toastTimer); });
</script>

<template>
  <div class="page library">
    <header class="library__head">
      <h1 class="display">{{ $t("preset.title") }}</h1>
      <p class="muted">{{ $t("preset.lede") }}</p>
    </header>

    <PresetTabs v-if="!needsConsent" current="library" />

    <PresetReauth v-if="needsConsent" @confirm="reauthorize" @cancel="router.push(lp('/me/presets'))" />

    <template v-else>
      <div class="library__filters" role="group" :aria-label="$t('preset.share.filter.label')">
        <button type="button" class="library__pill" :class="{ 'library__pill--on': model === 'all' }" :aria-pressed="model === 'all'" data-testid="share-filter-all" @click="setQuery({ model: 'all' })">{{ $t("preset.share.filter.all") }}</button>
        <button type="button" class="library__pill" :class="{ 'library__pill--on': model === 'general' }" :aria-pressed="model === 'general'" data-testid="share-filter-general" @click="setQuery({ model: 'general' })">{{ $t("preset.share.filter.general") }}</button>
        <div class="library__pick" data-testid="share-filter-model">
          <PresetModelPicker v-model="picked" :groups="catalog" :multiple="false" input-id="share-filter-model" :label="$t('preset.share.filter.label')" />
        </div>
      </div>

      <section v-if="hotLoading || hot.length" class="library__hot" aria-labelledby="library-hot" data-testid="library-hot">
        <div class="library__sectionHead">
          <h2 id="library-hot" class="library__h2">{{ $t("preset.share.hot.title") }}</h2>
          <span class="subtle">{{ $t("preset.share.hot.note") }}</span>
        </div>
        <!-- 手機橫向捲動：捲動容器本身不加左右邊距，邊距放在內層，卡片滑到螢幕邊才消失 -->
        <div class="library__hotScroll">
          <ul class="library__hotList" :aria-busy="hotLoading || undefined">
            <template v-if="hotLoading && !hot.length">
              <li v-for="n in 3" :key="n" class="panel library__hotCard ghost" />
            </template>
            <li v-for="item in hot" :key="item.presetId" class="library__hotItem">
              <RouterLink :to="lp(`/presets/${item.presetId}`)" class="panel library__hotCard" data-testid="library-hot-card">
                <strong class="library__hotName">{{ item.title }}</strong>
                <span class="library__hotAuthor">{{ authorLabel(item) }}</span>
                <span v-if="item.fresh" class="chip library__fresh" data-testid="library-fresh">{{ $t("preset.share.new") }}</span>
                <span v-else class="library__hotStats">{{ hotStats(item) }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>

      <section class="library__all" aria-labelledby="library-all">
        <div class="library__sectionHead library__sectionHead--all">
          <h2 id="library-all" class="library__h2">{{ $t("preset.share.all.title") }}</h2>
          <div class="library__allTools">
            <label class="library__search">
              <span class="sr-only">{{ $t("preset.share.search.label") }}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
              <input v-model="typed" type="search" autocomplete="off" class="input" maxlength="64" :placeholder="$t('preset.share.search.placeholder')" data-testid="share-search" />
            </label>
            <div class="seg library__sort" role="group" :aria-label="$t('preset.share.sort.label')">
              <button type="button" class="seg__item" :class="{ 'seg__item--on': sort === 'hot' }" :aria-pressed="sort === 'hot'" data-testid="library-sort-hot" @click="setQuery({ sort: 'hot' })">{{ $t("preset.share.sort.hot") }}</button>
              <button type="button" class="seg__item" :class="{ 'seg__item--on': sort === 'new' }" :aria-pressed="sort === 'new'" data-testid="library-sort-new" @click="setQuery({ sort: 'new' })">{{ $t("preset.share.sort.new") }}</button>
            </div>
          </div>
        </div>

        <ul v-if="loading && !items.length" class="library__list" aria-busy="true">
          <li v-for="n in 3" :key="n" class="panel library__ghost ghost" />
        </ul>
        <section v-else-if="failed" class="panel library__card" role="alert">
          <p>{{ $t("preset.share.error.load") }}</p>
          <button type="button" class="btn btn--sm" @click="load()">{{ $t("preset.list.retry") }}</button>
        </section>
        <section v-else-if="!items.length" class="panel library__card" data-testid="share-public-empty">
          <p class="muted">{{ $t("preset.share.empty.public") }}</p>
        </section>
        <ul v-else class="library__list" :aria-busy="loading || undefined" data-testid="library-list">
          <PresetLibraryRow v-for="item in items" :key="item.presetId" :item="item" :busy="busy === item.presetId" @favorite="toggle" />
        </ul>
        <button v-if="hasMore && !loading && !failed" type="button" class="btn btn--lg library__more" :disabled="loadingMore" data-testid="share-more" @click="load(true)">{{ $t("preset.list.more") }}</button>
      </section>
    </template>

    <div class="toast" role="status" :hidden="!toast" data-testid="preset-toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.library { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-6) var(--s-7); max-width: 860px; }
.library__head { display: grid; gap: var(--s-2); }
.library__head p { margin: 0; }
.library__filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.library__pill {
  height: var(--h-md); padding: 0 var(--s-4); border-radius: var(--r-pill);
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--text);
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.library__pill:hover { background: var(--surface-2); }
.library__pill--on, .library__pill--on:hover { background: var(--accent-tint); border-color: transparent; color: var(--accent-text); }
/* 系列／模型選單（跟編輯器、公開彈層同一個）：桌機固定寬跟全部／通用同排，手機吃剩下的寬 */
.library__pick { flex: none; width: 280px; min-width: 0; }
.library__sectionHead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--s-1) var(--s-3); }
.library__h2 { margin: 0; font-size: 18px; font-weight: 700; }
.library__hot, .library__all { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
.library__hotList { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); }
.library__hotItem { min-width: 0; }
.library__hotCard {
  height: 100%; min-height: 100px; padding: var(--s-3) var(--s-4); display: flex; flex-direction: column; gap: var(--s-1);
  color: inherit; text-decoration: none; transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
a.library__hotCard:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); }
a.library__hotCard:hover .library__hotName { color: var(--accent-text); }
.library__hotName { font-size: 15px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.library__hotAuthor { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.library__hotStats { margin-top: auto; font-size: 12px; color: var(--text-3); }
.library__fresh, .library__fresh:hover { margin-top: auto; align-self: flex-start; height: 22px; background: var(--accent-tint); color: var(--accent-text); font-weight: 500; cursor: default; }
.library__allTools { display: flex; align-items: center; gap: var(--s-3); }
.library__search { position: relative; display: block; width: 320px; }
.library__search svg { position: absolute; left: 12px; top: 50%; translate: 0 -50%; color: var(--text-3); pointer-events: none; }
.library__search .input { width: 100%; padding-left: 36px; }
.library__sort { flex: none; }
.library__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
.library__ghost { height: 104px; }
.library__card { padding: var(--s-5); display: grid; gap: var(--s-3); justify-items: start; }
.library__card p { margin: 0; }
:lang(ko) .library__card p, :lang(ko) .library__head p { word-break: keep-all; }
.library__more { justify-self: center; }
@media (max-width: 760px) {
  .library__pick { flex: 1 1 0; width: auto; min-width: 140px; }
  /* 熱門：橫向捲動的卡片列，捲動容器貼邊、邊距放內層（DESIGN §5） */
  /* scroll-padding：吸附對齊內層邊距，不然一開就捲進 16px、第一張卡貼著螢幕邊 */
  .library__hotScroll { margin-inline: calc(-1 * var(--s-4)); overflow-x: auto; scroll-snap-type: x proximity; scroll-padding-inline: var(--s-4); scrollbar-width: none; }
  .library__hotScroll::-webkit-scrollbar { display: none; }
  .library__hotList { display: flex; width: max-content; padding: 2px var(--s-4) var(--s-2); }
  .library__hotItem { width: 224px; scroll-snap-align: start; }
  .library__hotCard { min-height: 108px; }
  .library__sectionHead--all { align-items: center; }
  .library__allTools { display: contents; }
  .library__search { order: 3; width: 100%; }
  .library__search .input { height: var(--h-lg); font-size: 15px; }
}
</style>
