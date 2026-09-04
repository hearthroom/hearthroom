<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchMyCards, registerCard, unregisterCard, type MyCard, type MyCardPage } from "@/lib/api";
import { useLocalePath } from "@/lib/use-locale";
import MyCardTile from "@/components/MyCardTile.vue";
import * as cache from "@/lib/mine-cache";
import { useSession } from "@/lib/session";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();

const data = ref<MyCardPage | null>(null);
const loading = ref(true);
const revalidating = ref(false);
const error = ref("");
const busy = ref<string | null>(null);

type Filter = "all" | "listed" | "unlisted";
const filter = computed<Filter>(() => {
  const f = route.query.filter;
  return f === "listed" || f === "unlisted" ? f : "all";
});
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1));

const visible = computed<MyCard[]>(() => {
  const items = data.value?.items ?? [];
  if (filter.value === "listed") return items.filter((c) => c.registered);
  if (filter.value === "unlisted") return items.filter((c) => !c.registered);
  return items;
});
const listedCount = computed(() => (data.value?.items ?? []).filter((c) => c.registered).length);

/**
 * 先畫快取、同時在背景重抓。
 *
 * loading 只在「完全沒東西可畫」時才為真——手上有舊資料時不該退回骨架屏，
 * 那會讓每次回到這頁都閃一下。
 */
async function load(opts: { fresh?: boolean } = {}) {
  error.value = "";
  const me = session.me;
  if (!me) return;

  const cached = opts.fresh ? null : cache.read(me.accountNumId, page.value);
  if (cached) {
    data.value = cached.page;
    loading.value = false;
    if (!cached.stale) return;
  } else {
    loading.value = !data.value;
  }

  revalidating.value = true;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const fresh = await fetchMyCards(token, { page: page.value, fresh: opts.fresh });
    data.value = fresh;
    cache.write(me.accountNumId, page.value, fresh);
  } catch (err) {
    // 有舊資料時，重抓失敗不該把畫面清空——顯示錯誤，但讓使用者繼續看得到東西。
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
    revalidating.value = false;
  }
}

async function toggle(card: MyCard) {
  busy.value = card.roleId;
  error.value = "";
  const before = card.registered;
  // 樂觀更新：登記是本站自己的資料，往返很快，失敗再翻回來。
  card.registered = !before;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    if (before) await unregisterCard(card.roleId, token);
    else await registerCard(card.roleId, token);
    if (session.me) cache.write(session.me.accountNumId, page.value, data.value!);
  } catch (err) {
    card.registered = before;
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}

function go(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "all") delete query[k];
    else query[k] = v;
  }
  router.push({ query });
}

watch(() => [session.me?.accountNumId, page.value], () => load(), { immediate: true });
// 從建立／編輯頁回來時帶著 ?fresh=1：剛寫過的資料要繞過所有快取。
watch(() => route.query.fresh, (f) => {
  if (f !== "1") return;
  if (session.me) cache.invalidate(session.me.accountNumId);
  load({ fresh: true });
  go({ fresh: undefined });
});
</script>

<template>
  <div class="page">
    <header class="head">
      <div class="head__text">
        <h1 class="head__title display">{{ $t("mine.title") }}</h1>
        <!-- 數字跟標題排同一行：這是工作區，不是刊物封面，不需要一整塊 hero -->
        <dl v-if="data" class="tally">
          <div><dt>{{ $t("mine.tally.all") }}</dt><dd>{{ data.total }}</dd></div>
          <div><dt>{{ $t("mine.tally.listed") }}</dt><dd>{{ listedCount }}</dd></div>
          <span v-if="revalidating" class="subtle">{{ $t("mine.syncing") }}</span>
        </dl>
      </div>
      <RouterLink :to="lp('/create')" class="btn btn--primary">{{ $t("mine.create") }}</RouterLink>
    </header>

    <nav class="tabs filters">
      <button
        v-for="f in ['all', 'listed', 'unlisted']"
        :key="f"
        class="tabs__item"
        :class="{ 'tabs__item--on': filter === f }"
        @click="go({ filter: f, page: undefined })"
      >
        {{ $t(`mine.filter.${f}`) }}
      </button>
    </nav>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <div v-if="loading" class="wall">
      <div v-for="i in 12" :key="i" class="ghost" :style="{ animationDelay: `${i * 55}ms` }" />
    </div>

    <p v-else-if="!data?.items.length" class="notice">
      {{ $t("mine.empty") }}<RouterLink :to="lp('/create')">{{ $t("mine.empty.cta") }}</RouterLink>
    </p>

    <p v-else-if="!visible.length" class="notice">{{ $t("mine.emptyFilter") }}</p>

    <div v-else class="wall">
      <MyCardTile
        v-for="(card, i) in visible"
        :key="card.roleId"
        :card="card"
        :index="i"
        :busy="busy === card.roleId"
        @toggle="toggle(card)"
      />
    </div>

    <nav v-if="data && (page > 1 || data.hasNext)" class="pager">
      <button class="btn btn--sm" :disabled="page === 1" @click="go({ page: String(page - 1) })">← {{ $t("pager.prev") }}</button>
      <span class="subtle">{{ $t("pager.page", { n: page }) }}</span>
      <button class="btn btn--sm" :disabled="!data.hasNext" @click="go({ page: String(page + 1) })">{{ $t("pager.next") }} →</button>
    </nav>
  </div>
</template>

<style scoped>
.head {
  display: flex; flex-wrap: wrap; gap: var(--s-4);
  align-items: center; justify-content: space-between;
  margin-bottom: var(--s-3);
}
.head__text { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-6); min-width: 0; }
.head__title { margin: 0; font-size: clamp(26px, 3.6vw, 34px); }

.tally { display: flex; align-items: baseline; gap: var(--s-5); margin: 0; }
.tally > div { display: flex; align-items: baseline; gap: var(--s-2); }
.tally dt { font-size: 12px; color: var(--text-faint); }
.tally dd { margin: 0; font-family: var(--font-display); font-size: 20px; font-variant-numeric: tabular-nums; }

.filters { margin-bottom: var(--s-5); border-bottom: 1px solid var(--rule); }

/* 跟榜單同一套卡片牆語言。工作區的格子略寬一點，因為每張底下多兩顆按鈕。 */
.wall {
  display: grid;
  gap: var(--s-5) var(--s-4);
  grid-template-columns: repeat(auto-fill, minmax(clamp(150px, 24vw, 196px), 1fr));
}

.ghost {
  aspect-ratio: 3 / 4.9;
  border-radius: var(--r-md);
  background: linear-gradient(100deg, var(--paper-raised) 30%, var(--rule) 48%, var(--paper-raised) 66%);
  background-size: 300% 100%;
  animation: sweep 1.5s var(--ease) infinite;
}
@keyframes sweep { from { background-position: 130% 0; } to { background-position: -30% 0; } }

.pager { display: flex; align-items: center; justify-content: center; gap: var(--s-5); margin-top: var(--s-7); }
</style>
