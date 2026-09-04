<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import AuthorList from "@/components/AuthorList.vue";
import CardGrid from "@/components/CardGrid.vue";
import { fetchAuthors, fetchBoard, fetchTags } from "@/lib/api";
import { contentLang, defaultZone, pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { AuthorPage } from "@/lib/api";
import type { CardPage, CommunityCard } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale } = useLocalePath();
const { t } = useI18n();

const q = computed(() => (typeof route.query.q === "string" ? route.query.q.trim() : ""));
const draft = ref(q.value);
/** 預設搜目前語言那一區；明說 all 才跨語區。 */
const allZones = computed(() => route.query.zone === "all");
const kind = computed(() => (route.query.kind === "authors" ? "authors" : "cards"));
const offset = computed(() => Number(route.query.offset ?? 0) || 0);
const zone = computed(() => (allZones.value ? "all" : defaultZone(locale.value)));

const cards = ref<CardPage | null>(null);
const authors = ref<AuthorPage | null>(null);
const loading = ref(false);
const error = ref("");
/** 沒輸入字時給人一排熱門類型當起點；結果很少時底下接一排熱門卡，畫面不會只剩一張卡配一片空白 */
const tags = ref<{ tag: string; n: number }[]>([]);
const hot = ref<CommunityCard[]>([]);

async function load() {
  document.title = pageTitle(q.value ? `${q.value} · ${t("search.title")}` : t("search.title"));
  if (!q.value) { cards.value = null; authors.value = null; return; }
  loading.value = true;
  error.value = "";
  try {
    // 兩邊一起抓：分頁上的數字要同時知道兩種結果各有多少
    const [c, a] = await Promise.all([
      fetchBoard({ zone: zone.value, q: q.value, sort: "relevance", offset: kind.value === "cards" ? offset.value : 0, lang: contentLang(locale.value) }),
      fetchAuthors({ zone: zone.value, q: q.value, offset: kind.value === "authors" ? offset.value : 0 }),
    ]);
    cards.value = c;
    authors.value = a;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
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

const sparse = computed(() => !!q.value && !loading.value && kind.value === "cards" && cards.value !== null && cards.value.items.length < 4 && cards.value.offset === 0);
const hotShown = computed(() => {
  const seen = new Set(cards.value?.items.map((c) => c.roleId) ?? []);
  return hot.value.filter((c) => !seen.has(c.roleId));
});

function navigate(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete query[k];
    else query[k] = v;
  }
  if (!("offset" in patch)) delete query.offset;
  router.push({ query });
}
function submit() { navigate({ q: draft.value.trim() }); }
function searchTag(tag: string) { router.push({ path: withLocaleRoot(), query: { tag } }); }
const withLocaleRoot = () => route.path.replace(/\/search$/, "") || "/";

/** 結果數不確定（有篩選又還有下一頁）時只說「這一頁以上」，不假裝知道總數 */
const countLabel = (page: { total: number | null; hasNext: boolean; limit: number; items: unknown[] } | null | undefined) => {
  if (!page) return "";
  if (page.total !== null) return String(page.total);
  return page.hasNext ? `${page.limit}+` : String(page.items.length);
};

watch([() => route.query, locale], load, { immediate: true });
watch(locale, loadSide, { immediate: true });
watch(q, (v) => { draft.value = v; });
</script>

<template>
  <div class="page search">
    <form class="search__form" role="search" @submit.prevent="submit">
      <svg class="search__icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
        <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      </svg>
      <input v-model="draft" class="search__input" type="search" :placeholder="$t('search.placeholder')" :aria-label="$t('search.title')" autofocus enterkeyhint="search" />
      <button class="btn btn--primary btn--lg search__go" type="submit">{{ $t("board.search.submit") }}</button>
    </form>

    <template v-if="q">
      <div class="bar">
        <div class="seg">
          <button class="seg__item" :class="{ 'seg__item--on': kind === 'cards' }" :aria-pressed="kind === 'cards'" @click="navigate({ kind: undefined })">
            {{ $t("search.cards") }}<span class="seg__n">{{ countLabel(cards) }}</span>
          </button>
          <button class="seg__item" :class="{ 'seg__item--on': kind === 'authors' }" :aria-pressed="kind === 'authors'" @click="navigate({ kind: 'authors' })">
            {{ $t("search.authors") }}<span class="seg__n">{{ authors ? (authors.hasNext ? `${authors.limit}+` : String(authors.items.length)) : "" }}</span>
          </button>
        </div>
        <div class="seg">
          <button class="seg__item" :class="{ 'seg__item--on': !allZones }" :aria-pressed="!allZones" @click="navigate({ zone: undefined })">{{ $t("search.zone.current") }}</button>
          <button class="seg__item" :class="{ 'seg__item--on': allZones }" :aria-pressed="allZones" @click="navigate({ zone: 'all' })">{{ $t("search.zone.all") }}</button>
        </div>
      </div>

      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

      <template v-if="kind === 'cards'">
        <CardGrid
          :cards="cards?.items ?? []"
          :loading="loading && !cards"
          :busy="loading"
          :show-zone="allZones"
          :empty-title="$t('search.empty', { q })"
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
      <template v-else>
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
.search { max-width: 1100px; }
.search__form { position: relative; display: flex; gap: var(--s-2); margin-bottom: var(--s-4); }
.search__icon { position: absolute; left: 16px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.search__input {
  flex: 1; min-width: 0; height: var(--h-lg); padding: 0 var(--s-4) 0 46px;
  font: inherit; font-size: 16px; color: var(--text);
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r-pill);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.search__input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search__input::-webkit-search-cancel-button { -webkit-appearance: none; }
.search__go { flex: none; }

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
.search .zero + .also { margin-top: 0; }
</style>
