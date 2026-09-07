<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, fetchMyCards, registerCard, unregisterCard, type MyCard, type MyCardPage } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { daysUntilReset, remaining, weekRange } from "@/lib/quota";
import { useLocalePath } from "@/lib/use-locale";
import MyCardTile from "@/components/MyCardTile.vue";
import * as cache from "@/lib/mine-cache";
import { useSession } from "@/lib/session";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t, locale } = useI18n();

const data = ref<MyCardPage | null>(null);
const loading = ref(true);
const revalidating = ref(false);
const error = ref("");
const notice = ref("");
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
 * 這週的登記額度（服務端算的，這裡只排版）。
 * 額度用完時鎖住每張未登記卡的「登記」鍵——按下去只會得到一句拒絕，不如一開始就按不下去。
 */
const quota = computed(() => data.value?.quota ?? null);
const quotaLeft = computed(() => (quota.value ? remaining(quota.value) : 0));
const quotaFull = computed(() => !!quota.value && quotaLeft.value === 0);
const quotaRange = computed(() => (quota.value ? weekRange(quota.value, String(locale.value)) : null));
const quotaResetText = computed(() => {
  if (!quota.value) return "";
  const n = daysUntilReset(quota.value);
  return n <= 1 ? t("mine.quota.resetSoon") : t("mine.quota.reset", { n });
});

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

/**
 * 提交審核（登記）。
 *
 * 按下去之前先把話說清楚：提交等於把這張卡的完整設定授權給本站的審核帳號唯讀。
 * 這是作者的意思表示，服務端用他自己的 token 去主站授權，所以確認框不能省。
 */
async function submit(card: MyCard) {
  if (!card.registered && quotaFull.value) {
    error.value = t("mine.quota.exceeded");
    return;
  }
  const ok = await confirmDialog({
    title: t("mine.consent.title"),
    message: t("mine.consent.message"),
    confirmText: t("mine.consent.confirm"),
  });
  if (!ok) return;
  const wasRegistered = card.registered;
  busy.value = card.roleId;
  error.value = "";
  notice.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = (await registerCard(card.roleId, token)) as { status?: MyCard["status"] };
    card.registered = true;
    card.status = res.status ?? "approved";
    card.note = "";
    if (session.me) cache.write(session.me.accountNumId, page.value, filter.value, data.value!);
    // 登記成功就多用掉一格；撤銷不還——額度數的是「這週登記過幾張不同的卡」
    if (!wasRegistered && data.value) data.value.quota.used = Math.min(data.value.quota.limit, data.value.quota.used + 1);
    notice.value = card.status === "approved" ? "" : t("mine.submitted");
  } catch (err) {
    error.value =
      err instanceof ApiError && err.code === "weekly_quota_exceeded"
        ? t("mine.quota.exceeded")
        : err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}

async function toggle(card: MyCard) {
  if (!card.registered) return submit(card);
  busy.value = card.roleId;
  error.value = "";
  // 樂觀更新：撤銷是本站自己的資料，往返很快，失敗再翻回來。
  card.registered = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await unregisterCard(card.roleId, token);
    card.status = undefined;
    card.note = "";
    if (session.me) cache.write(session.me.accountNumId, page.value, filter.value, data.value!);
  } catch (err) {
    card.registered = true;
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

    <section v-if="quota && quotaRange" class="quota panel" :class="{ 'quota--full': quotaFull }" aria-live="polite">
      <div class="quota__count">
        <span class="eyebrow">{{ $t("mine.quota.eyebrow") }}</span>
        <span class="quota__num display">
          <strong>{{ quota.used }}</strong><span class="quota__sep">/</span>{{ quota.limit }}
          <span class="quota__unit">{{ $t("mine.quota.unit") }}</span>
        </span>
      </div>
      <ol class="quota__pips" aria-hidden="true">
        <li v-for="i in quota.limit" :key="i" class="quota__pip" :class="{ 'quota__pip--on': i <= quota.used }" />
      </ol>
      <div class="quota__when">
        <span class="quota__range">{{ $t("mine.quota.range", quotaRange) }}</span>
        <span class="quota__state" :class="{ 'quota__state--full': quotaFull }">
          {{ quotaFull ? $t("mine.quota.full") : $t("mine.quota.left", { n: quotaLeft }) }}
          <span class="quota__dot">·</span>{{ quotaResetText }}
        </span>
      </div>
    </section>

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
    <p v-else-if="notice" class="notice" role="status">{{ notice }}</p>

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
        :locked="quotaFull"
        :busy="busy === card.roleId"
        @toggle="toggle(card)"
        @resubmit="submit(card)"
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

/* 這週的額度：一張卡，左邊數字、中間三格、右邊週起訖與狀態。手機上三段自動換行。 */
.quota {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3) var(--s-5);
  padding: var(--s-3) var(--s-4); margin-bottom: var(--s-4);
}
.quota__count { display: grid; gap: 2px; }
.quota__num { font-size: 22px; line-height: 1.1; color: var(--text-2); font-variant-numeric: tabular-nums; }
.quota__num strong { font-size: 28px; color: var(--text); }
.quota__sep { margin: 0 3px; color: var(--text-3); font-weight: 500; }
.quota__unit { margin-left: 4px; font-size: 12.5px; font-weight: 500; color: var(--text-3); }
.quota__pips { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; }
.quota__pip { width: 28px; height: 8px; border-radius: 999px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
.quota__pip--on { background: var(--accent-grad); box-shadow: none; }
.quota--full .quota__pip--on { background: var(--text-3); }
.quota__when { margin-left: auto; display: grid; gap: 2px; text-align: right; }
.quota__range { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.quota__state { font-size: 12.5px; color: var(--text-3); }
.quota__state--full { color: var(--text-2); font-weight: 500; }
.quota__dot { margin: 0 6px; }
@media (max-width: 520px) {
  .quota__when { margin-left: 0; text-align: left; flex-basis: 100%; }
}

.wall {
  display: grid; gap: var(--s-4);
  /*
   * 欄數釘死，不讓它隨寬度自動算：一頁 24 張，欄數必須整除 24，最後一列才不會缺角
   * （owner 2026-09-07：桌機自動算出 5 欄，最後一列只剩 4 張）。2／3／4／6 都整除 24；
   * 手機兩欄、平板三到四欄、桌機六欄——1080px 以上六欄每張仍有 158px 以上，名字放得下。
   */
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 600px) { .wall { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 820px) { .wall { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 1080px) { .wall { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.ghost--card { aspect-ratio: 3 / 5.4; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-4); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
</style>
