<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthorList from "@/components/AuthorList.vue";
import CardGrid from "@/components/CardGrid.vue";
import { fetchAuthors, fetchBoard, fetchTags, searchTags } from "@/lib/api";
import { contentLang, defaultZone, pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import DiscoveryTags from "@/components/DiscoveryTags.vue";
import { selectedTags, toggleTag } from "@/lib/discovery";
import { TAG_CATALOG, tagLabel } from "../../../shared/tag-catalog";
import type { TagPage, AuthorPage } from "@/lib/api";
import type { CardPage, CommunityCard } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const session = useSession();
const { t } = useI18n();

const q = computed(() => (typeof route.query.q === "string" ? route.query.q.trim() : ""));
const draft = ref(q.value);
/* 焦點自己接：換頁後 router 會先把焦點放到 main，瀏覽器的 autofocus 就不生效了 */
const box = ref<HTMLInputElement | null>(null);
onMounted(() => { void nextTick(() => box.value?.focus()); });
/** 預設搜目前語言那一區；明說 all 才跨語區。 */
const allZones = computed(() => route.query.zone === "all");
const kind = computed(() => (route.query.kind === "authors" || route.query.kind === "tags" ? route.query.kind : "cards"));
const offset = computed(() => Number(route.query.offset ?? 0) || 0);
const zone = computed(() => (allZones.value ? "all" : defaultZone(locale.value)));

const selected = computed(() => selectedTags(route.query.tag));
const filtersOpen = ref(false);
const PERIODS = ["all", "week", "month", "quarter", "year"];
const period = computed(() => typeof route.query.period === "string" && PERIODS.includes(route.query.period) ? route.query.period : "all");
const sort = computed(() => route.query.sort === "new" ? "new" : "hot");
const hasQuery = computed(() => !!q.value || selected.value.length > 0 || kind.value !== "cards" || period.value !== "all" || route.query.sort !== undefined);
const tagResults = ref<TagPage | null>(null);
const selectedLabel = (tag: string) => { const entry = TAG_CATALOG.find(x => x.key === tag); return entry ? tagLabel(entry, locale.value) : tag; };
const cards = ref<CardPage | null>(null);
const authors = ref<AuthorPage | null>(null);
const loading = ref(false);
const error = ref("");
/** 沒輸入字時給人一排熱門類型當起點；結果很少時底下接一排熱門卡，畫面不會只剩一張卡配一片空白 */
const tags = ref<{ tag: string; n: number }[]>([]);
const hot = ref<CommunityCard[]>([]);

let loadId = 0;
async function load() {
  const id = ++loadId;
  document.title = pageTitle(q.value ? `${q.value} · ${t("search.title")}` : t("search.title"));
  if (!hasQuery.value) { cards.value = null; authors.value = null; tagResults.value = null; error.value = ""; loading.value = false; return; }
  loading.value = true;
  error.value = "";
  try {
    // 三種結果一起抓，分頁數字維持同一組關鍵字與語區。
    const [c, a, tg] = await Promise.all([
      fetchBoard({ zone: zone.value, q: q.value, tag: selected.value, period: period.value, sort: sort.value, offset: kind.value === "cards" ? offset.value : 0, lang: contentLang(locale.value) }),
      fetchAuthors({ zone: zone.value, q: q.value, offset: kind.value === "authors" ? offset.value : 0 }),
      searchTags(zone.value, q.value, kind.value === "tags" ? offset.value : 0),
    ]);
    if (id !== loadId) return;
    cards.value = c;
    tagResults.value = tg;
    authors.value = a;
  } catch (err) {
    if (id !== loadId) return;
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    if (id === loadId) loading.value = false;
  }
}
async function loadSide() {
  const z = defaultZone(locale.value);
  const [tg, hb] = await Promise.all([
    fetchTags(z).catch(() => []),
    fetchBoard({ zone: z, sort: "hot", limit: 4, lang: contentLang(locale.value) }).then((b) => b.items).catch(() => []),
  ]);
  tags.value = tg.slice(0, 12);
  hot.value = hb;
}

const sparse = computed(() => !!q.value && !selected.value.length && period.value === "all" && !error.value && !loading.value && kind.value === "cards" && cards.value !== null && cards.value.items.length < 4 && cards.value.offset === 0);
const hotShown = computed(() => {
  const seen = new Set(cards.value?.items.map((c) => c.roleId) ?? []);
  return hot.value.filter((c) => !seen.has(c.roleId));
});

function navigate(patch: Record<string, string | string[] | undefined>) {
  const query: Record<string, string | string[]> = { ...(route.query as Record<string, string | string[]>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete query[k];
    else query[k] = v;
  }
  if (!("offset" in patch)) delete query.offset;
  router.push({ query });
}
/** 純數字就是卡號（玩家在別處拿到的那個短號）：直接開那張卡，不當關鍵字搜 */
function submit() {
  const q = draft.value.trim();
  if (/^#?[1-9]\d{0,11}$/.test(q)) { router.push(lp(`/cards/${q.replace(/^#/, "")}`)); return; }
  navigate({ q });
}
function searchTag(tag: string) { navigate({ kind: undefined, q: undefined, tag: [tag] }); }

/** 結果數不確定（有篩選又還有下一頁）時只說「這一頁以上」，不假裝知道總數 */
const countLabel = (page: { total: number | null; hasNext: boolean; limit: number; items: unknown[] } | null | undefined) => {
  if (!page) return "";
  if (page.total !== null) return String(page.total);
  return page.hasNext ? `${page.limit}+` : String(page.items.length);
};

watch([() => route.query, locale], load, { immediate: true });
// 開關改了要重讀；身分剛載好、發現本來就開著（undefined → true）也要——第一次讀多半比身分早到
watch(() => session.profile?.showNsfw, (now, before) => { if (now !== before && (now === true || before !== undefined)) load(); });
/** 不想看的類型：結果由伺服器過濾；這裡只在結果上方提一句，人才知道為什麼少了卡 */
const hidden = computed(() => session.profile?.hiddenTags ?? []);
watch(() => hidden.value.join(","), (now, before) => { if (now !== before && (now !== "" || before !== undefined)) { load(); loadSide(); } });
watch(locale, loadSide, { immediate: true });
watch(q, (v) => { draft.value = v; });
</script>

<template>
  <div class="page page--search">
    <form class="search__form" role="search" @submit.prevent="submit">
      <button v-if="kind === 'cards'" class="btn btn--lg search__filter" :class="{ 'search__filter--on': selected.length || filtersOpen }" type="button" :aria-expanded="filtersOpen" aria-controls="search-filters" @click="filtersOpen = !filtersOpen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
        {{ $t('search.filter') }}<span v-if="selected.length">{{ selected.length }}</span>
      </button>
      <div class="search__field">
      <svg class="search__icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
        <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      </svg>
      <input ref="box" v-model="draft" class="search__input" type="search" :placeholder="$t('search.placeholder')" :aria-label="$t('search.title')" enterkeyhint="search" />
      </div>
      <button class="btn btn--primary btn--lg search__go" type="submit">{{ $t("board.search.submit") }}</button>
    </form>

      <div class="bar">
        <div class="seg">
          <button class="seg__item" :class="{ 'seg__item--on': kind === 'cards' }" :aria-pressed="kind === 'cards'" @click="navigate({ kind: undefined })">
            {{ $t("search.cards") }}<span class="seg__n">{{ countLabel(cards) }}</span>
          </button>
          <button class="seg__item" :class="{ 'seg__item--on': kind === 'authors' }" :aria-pressed="kind === 'authors'" @click="navigate({ kind: 'authors' })">
            {{ $t("search.users") }}<span class="seg__n">{{ authors ? (authors.hasNext ? `${authors.limit}+` : String(authors.items.length)) : "" }}</span>
          </button>
          <button class="seg__item" :class="{ 'seg__item--on': kind === 'tags' }" :aria-pressed="kind === 'tags'" @click="navigate({ kind: 'tags' })">{{ $t('search.tags') }}<span class="seg__n">{{ tagResults ? (tagResults.hasNext ? `${tagResults.offset + tagResults.limit}+` : String(tagResults.offset + tagResults.items.length)) : '' }}</span></button>
        </div>
        <div class="bar__options">
          <template v-if="kind === 'cards'">
            <label class="sr-only" for="search-period">{{ $t('search.period') }}</label>
            <select id="search-period" name="period" class="search__select" :value="period" :title="$t('search.periodHint')" @change="navigate({ period: ($event.target as HTMLSelectElement).value })">
              <option v-for="p in PERIODS" :key="p" :value="p">{{ $t(`search.period.${p}`) }}</option>
            </select>
            <label class="sr-only" for="search-sort">{{ $t('board.sorts') }}</label>
            <select id="search-sort" name="sort" class="search__select" :value="sort" @change="navigate({ sort: ($event.target as HTMLSelectElement).value })">
              <option value="hot">{{ $t('board.sort.hot') }}</option><option value="new">{{ $t('board.sort.new') }}</option>
            </select>
          </template>
        <div class="seg">
          <button class="seg__item" :class="{ 'seg__item--on': !allZones }" :aria-pressed="!allZones" @click="navigate({ zone: undefined })">{{ $t("search.zone.current") }}</button>
          <button class="seg__item" :class="{ 'seg__item--on': allZones }" :aria-pressed="allZones" @click="navigate({ zone: 'all' })">{{ $t("search.zone.all") }}</button>
        </div>
        </div>
      </div>

      <div v-if="kind === 'cards' && filtersOpen" id="search-filters" class="search__filters panel">
        <p class="muted">{{ $t('search.matchAll') }}</p>
        <DiscoveryTags :selected="selected" :hidden="hidden" @change="navigate({ tag: $event.length ? $event : undefined })" />
      </div>
      <div v-if="kind === 'cards' && selected.length && !filtersOpen" class="search__selected">
        <button v-for="tag in selected" :key="tag" class="tagchip" @click="navigate({ tag: toggleTag(selected, tag) })">{{ selectedLabel(tag) }} <span aria-hidden="true">×</span></button>
        <button class="btn btn--sm" @click="navigate({ tag: undefined })">{{ $t('search.clear') }}</button>
      </div>
    <template v-if="hasQuery">
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <p v-if="kind === 'cards' && hidden.length" class="muted search__hidden">
        <RouterLink :to="lp('/settings') + '#hidden'">{{ $t("board.hidden", { n: hidden.length }) }}</RouterLink>
      </p>

      <template v-if="kind === 'cards'">
        <CardGrid
          :cards="cards?.items ?? []"
          :loading="loading && !cards"
          :busy="loading"
          :show-zone="allZones"
          :empty-title="q ? $t('search.empty', { q }) : $t('board.empty.search.title')"
          :empty-hint="$t('board.empty.search.hint')"
        />
        <nav v-if="cards && (cards.offset > 0 || cards.hasNext)" class="pager">
          <button class="btn btn--sm" :disabled="cards.offset === 0" @click="navigate({ offset: String(Math.max(0, cards.offset - cards.limit)) })">← {{ $t("pager.prev") }}</button>
          <span class="subtle">{{ $t("pager.page", { n: Math.floor(cards.offset / cards.limit) + 1 }) }}</span>
          <button class="btn btn--sm" :disabled="!cards.hasNext" @click="navigate({ offset: String(cards.offset + cards.limit) })">{{ $t("pager.next") }} →</button>
        </nav>
        <section v-if="sparse && hotShown.length" class="also">
          <h2 class="also__title">{{ $t("search.alsoHot") }}</h2>
          <CardGrid :cards="hotShown" />
        </section>
      </template>
      <template v-else-if="kind === 'authors'">
        <div v-if="loading && !authors" class="ghosts"><div v-for="i in 6" :key="i" class="ghost" /></div>
        <div v-else-if="!authors?.items.length" class="empty panel">
          <p class="empty__title">{{ $t("search.empty", { q }) }}</p>
          <p class="empty__hint muted">{{ $t("board.empty.search.hint") }}</p>
        </div>
        <AuthorList v-else :authors="authors.items" />
        <nav v-if="authors && (authors.offset > 0 || authors.hasNext)" class="pager">
          <button class="btn btn--sm" :disabled="authors.offset === 0" @click="navigate({ offset: String(Math.max(0, authors.offset - authors.limit)) })">← {{ $t("pager.prev") }}</button>
          <span class="subtle">{{ $t("pager.page", { n: Math.floor(authors.offset / authors.limit) + 1 }) }}</span>
          <button class="btn btn--sm" :disabled="!authors.hasNext" @click="navigate({ offset: String(authors.offset + authors.limit) })">{{ $t("pager.next") }} →</button>
        </nav>
      </template>
      <template v-else>
        <div v-if="loading && !tagResults" class="ghosts"><div v-for="i in 3" :key="i" class="ghost" /></div>
        <div v-else-if="!tagResults?.items.length" class="empty panel"><p class="empty__title">{{ $t('search.empty', { q }) }}</p><p class="muted">{{ $t('board.empty.search.hint') }}</p></div>
        <div v-else class="search__tag-results" :aria-busy="loading">
          <button v-for="x in tagResults.items" :key="x.tag" class="search__tag-result panel" @click="searchTag(x.tag)"><span># {{ x.tag }}</span><span class="muted">{{ $t('board.count', { n: x.n }) }} →</span></button>
        </div>
        <nav v-if="tagResults && (tagResults.offset > 0 || tagResults.hasNext)" class="pager">
          <button class="btn btn--sm" :disabled="tagResults.offset === 0" @click="navigate({ offset: String(Math.max(0, tagResults.offset - tagResults.limit)) })">← {{ $t('pager.prev') }}</button>
          <span class="subtle">{{ $t('pager.page', { n: Math.floor(tagResults.offset / tagResults.limit) + 1 }) }}</span>
          <button class="btn btn--sm" :disabled="!tagResults.hasNext" @click="navigate({ offset: String(tagResults.offset + tagResults.limit) })">{{ $t('pager.next') }} →</button>
        </nav>
      </template>
    </template>

    <template v-else>
      <section v-if="tags.length" class="zero">
        <h2 class="also__title">{{ $t("search.popular") }}</h2>
        <div class="zero__tags">
          <button v-for="x in tags" :key="x.tag" class="tagchip" @click="searchTag(x.tag)">{{ x.tag }}<span class="tagchip__n">{{ x.n }}</span></button>
        </div>
      </section>
      <section v-if="hot.length" class="also">
        <h2 class="also__title">{{ $t("search.alsoHot") }}</h2>
        <CardGrid :cards="hot" />
      </section>
      <p v-if="!tags.length && !hot.length" class="muted search__hint">{{ $t("search.hint") }}</p>
    </template>
  </div>
</template>

<style scoped>
/* 根節點不能叫 .search：App.vue 為手機隱藏頁首搜尋框的 scoped 規則會打到子元件根節點，整頁消失 */
.page--search { max-width: 1100px; }
.search__form { position: relative; display: flex; gap: var(--s-2); margin-bottom: var(--s-4); }
.search__icon { position: absolute; left: 16px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.search__input {
  width: 100%; min-width: 0; height: var(--h-lg); padding: 0 var(--s-4) 0 46px;
  font: inherit; font-size: 16px; color: var(--text);
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r-pill);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.search__input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search__input::-webkit-search-cancel-button { -webkit-appearance: none; }
.search__go { flex: none; }
.search__field { position: relative; flex: 1; min-width: 0; }
.search__filter { gap: var(--s-2); }
.search__filter svg { width: 1.15em; height: 1.15em; }
.search__filter--on { color: var(--accent-text); border-color: var(--accent); }
.bar__options { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin-left: auto; }
.search__select { min-height: var(--h-md); padding: 0 var(--s-3); color: var(--text); background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-pill); font: inherit; font-size: 13px; cursor: pointer; }
.search__filters { padding: var(--s-4); margin-bottom: var(--s-4); }
.search__filters p { margin-bottom: var(--s-2); font-size: 13px; }
.search__filters :deep(.discovery-tags) { margin-bottom: 0; }
.search__selected { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-bottom: var(--s-4); }
.search__tag-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: var(--s-3); }
.search__tag-result { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-4); color: var(--text); font: inherit; cursor: pointer; text-align: start; }
.search__tag-result > span { overflow-wrap: anywhere; }
.search__tag-result:hover { border-color: var(--accent); }
@media (max-width: 640px) {
  .bar__options { margin-left: 0; width: 100%; }
  .search__form { gap: var(--s-2); }
  .search__filter, .search__go { padding-inline: var(--s-3); }
  .search__filter svg { display: none; }
  .search__select, .seg__item, .tagchip, .search__selected .btn { min-height: var(--h-lg); }
}

.bar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-4); }
.seg__n { margin-left: 6px; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.seg__item--on .seg__n { color: var(--text-2); }
.ghosts { display: grid; gap: 6px; }
.ghosts .ghost { height: 62px; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; }
.search__hint { padding: var(--s-7) 0; text-align: center; font-size: 13.5px; }

.zero { display: grid; gap: var(--s-3); margin-bottom: var(--s-6); }
.zero__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tagchip {
  display: inline-flex; align-items: center; gap: 5px;
  height: var(--h-sm); padding: 0 12px; white-space: nowrap;
  background: var(--surface); border: 0; border-radius: var(--r-pill);
  box-shadow: 0 0 0 1px var(--line);
  font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.tagchip:hover { color: var(--text); box-shadow: 0 0 0 1px var(--line-strong); }
.tagchip__n { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }

.also { display: grid; gap: var(--s-3); margin-top: var(--s-6); }
.also__title { font-size: 14px; font-weight: 600; }
.zero .also__title { margin: 0; }
.page--search .zero + .also { margin-top: 0; }
.search__hidden { margin: 0 0 var(--s-3); font-size: 13px; }
.search__hidden a { color: inherit; text-decoration: underline dashed; text-underline-offset: 3px; }
</style>
