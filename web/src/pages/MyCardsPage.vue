<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { fetchMyCards, registerCard, unregisterCard, type MyCard, type MyCardPage } from "@/lib/api";
import { compact, hueFrom } from "@/lib/format";
import * as cache from "@/lib/mine-cache";
import { useSession } from "@/lib/session";

const route = useRoute();
const router = useRouter();
const session = useSession();

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
    if (!token) throw new Error("登入已失效，請重新登入");
    const fresh = await fetchMyCards(token, { page: page.value, fresh: opts.fresh });
    data.value = fresh;
    cache.write(me.accountNumId, page.value, fresh);
  } catch (err) {
    // 有舊資料時，重抓失敗不該把畫面清空——顯示錯誤，但讓使用者繼續看得到東西。
    error.value = err instanceof Error ? err.message : "載入失敗";
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
    if (!token) throw new Error("登入已失效，請重新登入");
    if (before) await unregisterCard(card.roleId, token);
    else await registerCard(card.roleId, token);
    if (session.me) cache.write(session.me.accountNumId, page.value, data.value!);
  } catch (err) {
    card.registered = before;
    error.value = err instanceof Error ? err.message : "操作失敗";
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
      <div>
        <p class="eyebrow">作者工作區</p>
        <h1 class="head__title display">我的角色卡</h1>
      </div>
      <RouterLink to="/create" class="btn btn--primary">建立新卡</RouterLink>
    </header>

    <div v-if="data" class="tally">
      <div><dt>全部</dt><dd>{{ data.total }}</dd></div>
      <div><dt>已登記</dt><dd>{{ listedCount }}</dd></div>
      <div><dt>本頁</dt><dd>{{ data.items.length }}</dd></div>
      <span v-if="revalidating" class="tally__sync subtle">更新中…</span>
    </div>

    <nav class="filters">
      <button
        v-for="f in [
          { key: 'all', label: '全部' },
          { key: 'listed', label: '已登記' },
          { key: 'unlisted', label: '未登記' },
        ]"
        :key="f.key"
        class="filters__item"
        :class="{ 'filters__item--on': filter === f.key }"
        @click="go({ filter: f.key, page: undefined })"
      >
        {{ f.label }}
      </button>
    </nav>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <ul v-if="loading" class="list">
      <li v-for="i in 6" :key="i" class="row row--ghost" :style="{ animationDelay: `${i * 60}ms` }" />
    </ul>

    <p v-else-if="!data?.items.length" class="notice">
      你還沒有任何角色卡。<RouterLink to="/create">先建立一張</RouterLink>。
    </p>

    <p v-else-if="!visible.length" class="notice">
      這個篩選下沒有卡片。
    </p>

    <ul v-else class="list">
      <li v-for="(card, i) in visible" :key="card.roleId" class="row rise" :style="{ animationDelay: `${Math.min(i, 9) * 35}ms` }">
        <img v-if="card.avatarUrl" :src="card.avatarUrl" alt="" class="row__art" />
        <div
          v-else
          class="row__art row__art--void"
          :style="{ background: `linear-gradient(150deg, hsl(${hueFrom(card.name)} 22% 24%), hsl(${(hueFrom(card.name) + 45) % 360} 18% 13%))` }"
        >
          {{ [...card.name][0] }}
        </div>

        <div class="row__body">
          <RouterLink :to="`/cards/${card.roleId}/edit`" class="row__name display">{{ card.name }}</RouterLink>
          <p class="row__hook subtle">{{ card.summary || "還沒有簡介" }}</p>
        </div>

        <span class="row__num subtle">{{ compact(card.talkNum) }} 次對話</span>

        <span class="tag" :class="card.registered ? 'tag--on' : ''">
          {{ card.registered ? "在榜上" : "未登記" }}
        </span>

        <div class="row__actions">
          <RouterLink class="btn btn--sm btn--ghost" :to="`/cards/${card.roleId}/edit`">編輯</RouterLink>
          <button
            class="btn btn--sm"
            :class="card.registered ? 'btn--danger' : 'btn--primary'"
            :disabled="busy === card.roleId"
            @click="toggle(card)"
          >
            {{ card.registered ? "取消登記" : "登記上榜" }}
          </button>
        </div>
      </li>
    </ul>

    <nav v-if="data && (page > 1 || data.hasNext)" class="pager">
      <button class="btn btn--sm" :disabled="page === 1" @click="go({ page: String(page - 1) })">← 上一頁</button>
      <span class="subtle">第 {{ page }} 頁</span>
      <button class="btn btn--sm" :disabled="!data.hasNext" @click="go({ page: String(page + 1) })">下一頁 →</button>
    </nav>
  </div>
</template>

<style scoped>
.head {
  display: flex; flex-wrap: wrap; gap: var(--s-4);
  align-items: flex-end; justify-content: space-between;
  margin-bottom: var(--s-5);
}
.head__title { margin: var(--s-1) 0 0; font-size: clamp(30px, 4.6vw, 42px); }

.tally { display: flex; align-items: baseline; gap: var(--s-6); margin: 0 0 var(--s-4); padding-bottom: var(--s-4); border-bottom: 1px solid var(--rule); }
.tally dt { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-faint); }
.tally dd { margin: 2px 0 0; font-family: var(--font-display); font-size: 24px; font-variant-numeric: tabular-nums; }
.tally__sync { margin-left: auto; }

.filters { display: flex; gap: var(--s-5); margin-bottom: var(--s-2); }
.filters__item {
  padding: 0 0 var(--s-2); margin-bottom: -1px;
  background: none; border: 0; border-bottom: 1px solid transparent; cursor: pointer;
  font-size: 14px; color: var(--text-faint);
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.filters__item:hover { color: var(--text-dim); }
.filters__item--on { color: var(--text); border-bottom-color: var(--gold); }

.list { display: grid; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }

.row {
  display: flex; align-items: center; gap: var(--s-4);
  padding: var(--s-3) 0;
  border-bottom: 1px solid var(--rule);
}
.row--ghost {
  height: 78px;
  background: linear-gradient(100deg, transparent 30%, var(--paper-raised) 48%, transparent 66%);
  background-size: 300% 100%;
  animation: sweep 1.5s var(--ease) infinite;
}
@keyframes sweep { from { background-position: 130% 0; } to { background-position: -30% 0; } }

.row__art { width: 44px; height: 58px; border-radius: var(--r-sm); object-fit: cover; flex: none; }
.row__art--void {
  display: grid; place-items: center;
  font-family: var(--font-display); font-size: 22px; color: rgba(255, 255, 255, 0.22);
}
.row__body { flex: 1; min-width: 0; }
.row__name { font-size: 18px; }
.row__name:hover { color: var(--gold); }
.row__hook { margin: 1px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__num { flex: none; font-variant-numeric: tabular-nums; }

.tag {
  flex: none; padding: 2px var(--s-3);
  font-size: 12px; color: var(--text-faint);
  border: 1px solid var(--rule); border-radius: var(--r-pill);
}
.tag--on { color: var(--gold); border-color: var(--gold-deep); background: var(--gold-wash); }

.row__actions { display: flex; gap: var(--s-2); flex: none; }

.pager { display: flex; align-items: center; justify-content: center; gap: var(--s-5); margin-top: var(--s-6); }

@media (max-width: 760px) {
  .row { flex-wrap: wrap; }
  .row__num { display: none; }
  .row__actions { width: 100%; justify-content: flex-end; }
}
</style>
