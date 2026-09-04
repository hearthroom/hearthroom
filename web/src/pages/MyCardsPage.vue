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

/**
 * 篩選交給服務端做，不在這裡挑。
 *
 * 在手上這一頁挑，挑出來的是「這一頁裡已登記的」——作者有一百多張卡、一頁只抓
 * 二十幾張時，那個結果跟「我登記了哪些」差很多，而畫面上看不出差在哪。
 */
const visible = computed<MyCard[]>(() => data.value?.items ?? []);

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

  const cached = opts.fresh ? null : cache.read(me.accountNumId, page.value, filter.value);
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
    const fresh = await fetchMyCards(token, { page: page.value, fresh: opts.fresh, filter: filter.value });
    data.value = fresh;
    cache.write(me.accountNumId, page.value, filter.value, fresh);
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
    if (session.me) cache.write(session.me.accountNumId, page.value, filter.value, data.value!);
  } catch (err) {
    card.registered = before;
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}

function go(patch: Record<string, string | undefined>, replace = false) {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "all") delete query[k];
    else query[k] = v;
  }
  router[replace ? "replace" : "push"]({ query });
}

watch(() => [session.me?.accountNumId, page.value, filter.value], () => {
  // 帶著 fresh=1 進來的那一次交給下面那個 watcher，不然會先打一次舊快取再打一次 fresh
  if (route.query.fresh === "1") return;
  load();
}, { immediate: true });
// 從建立／編輯頁回來時帶著 ?fresh=1：剛寫過的資料要繞過所有快取。
watch(() => route.query.fresh, (f) => {
  if (f !== "1") return;
  if (session.me) cache.invalidate(session.me.accountNumId);
  load({ fresh: true });
  // replace 而不是 push：不然按返回會落回 ?fresh=1，又被推回來，永遠回不到編輯頁
  go({ fresh: undefined }, true);
  // immediate：從編輯頁回來是一次新的導航，這個元件掛載時 fresh 就已經是 1，沒有「變化」可等
}, { immediate: true });
</script>

<template>
  <div class="page">
    <header class="head">
      <div class="head__text">
        <h1 class="head__title display">{{ $t("mine.title") }}</h1>
        <p v-if="data" class="subtle">
          <template v-if="data.total !== null">{{ $t("mine.tally.all") }} {{ data.total }} · </template>
          {{ $t("mine.tally.listed") }} {{ data.registeredTotal }}
          <template v-if="revalidating"> · {{ $t("mine.syncing") }}</template>
        </p>
      </div>
      <RouterLink :to="lp('/create')" class="btn btn--primary">{{ $t("mine.create") }}</RouterLink>
    </header>

    <div class="seg filters">
      <button
        v-for="f in ['all', 'listed', 'unlisted']"
        :key="f"
        class="seg__item"
        :class="{ 'seg__item--on': filter === f }"
        :aria-pressed="filter === f"
        @click="go({ filter: f, page: undefined })"
      >
        {{ $t(`mine.filter.${f}`) }}
      </button>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div v-if="loading" class="wall" aria-hidden="true">
      <div v-for="i in 12" :key="i" class="ghost ghost--card" />
    </div>

    <div v-else-if="!data?.items.length" class="empty panel">
      <p class="empty__title">{{ $t("mine.empty") }}</p>
      <RouterLink :to="lp('/create')" class="btn btn--primary">{{ $t("mine.empty.cta") }}</RouterLink>
    </div>

    <div v-else-if="!visible.length" class="empty panel"><p class="empty__title">{{ $t("mine.emptyFilter") }}</p></div>

    <div v-else class="wall" :aria-busy="revalidating || undefined">
      <MyCardTile
        v-for="card in visible"
        :key="card.roleId"
        :card="card"
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
  margin-bottom: var(--s-4);
}
.head__title { font-size: clamp(20px, 2.6vw, 24px); margin-bottom: 2px; }
.filters { margin-bottom: var(--s-4); }

.wall {
  display: grid; gap: var(--s-4);
  grid-template-columns: repeat(auto-fill, minmax(clamp(140px, 40vw, 184px), 1fr));
}
.ghost--card { aspect-ratio: 3 / 5.4; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-4); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
</style>
