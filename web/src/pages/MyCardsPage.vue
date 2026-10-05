<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchMyCards, unregisterCard, type MyCard, type MyCardPage } from "@/lib/api";
import { daysUntilReset, remaining, weekRange } from "@/lib/quota";
import { useLocalePath } from "@/lib/use-locale";
import { groupWorks, workKey, type WorkspaceCard } from "@/lib/card-workspace";
import MyCardTile from "@/components/MyCardTile.vue";
import AgentOnboard from "@/components/AgentOnboard.vue";

import { useSession } from "@/lib/session";
import { connectionMessage } from "@/lib/distribution";
import { can, currentProvider, providerName, type ProviderId } from "@/lib/provider";
import { accountToken, connectAccount, needsReauthorization } from "@/lib/connections";
import { lastShown } from "@/lib/mine-memory";
import { confirmDialog } from "@/lib/confirm";
import { signedInHint } from "@/lib/signin-hint";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t, locale } = useI18n();

const rows = ref<Partial<Record<ProviderId, MyCard[]>>>({});
/** 符合目前搜尋與篩選的張數（每家各算） */
const totals = ref<Partial<Record<ProviderId, number>>>({});
const failures = ref<Partial<Record<ProviderId, string>>>({});
const reauth = ref<Partial<Record<ProviderId, boolean>>>({});
const quota = ref<MyCardPage["quota"] | null>(null);
const loading = ref(true);
const error = ref("");
const busy = ref<string | null>(null);
const providers = computed(() => session.profile?.identities.filter(i=>i.provider==='harbor').map(i=>i.provider as ProviderId) ?? (session.me ? [currentProvider()] : []));
const visible = computed(()=>groupWorks(rows.value));
/**
 * 搜尋、篩選、第幾頁都放在網址上：重新整理、上一頁、分享連結都停在同一個地方。
 * 作者卡多（幾百張）時靠這三樣找卡；一頁 PAGE_SIZE 張，有頁碼可以直接跳。
 */
const PAGE_SIZE = 24;
type Filter = "all" | "listed" | "unlisted";
const FILTERS: Filter[] = ["all", "listed", "unlisted"];
const q = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const filter = computed<Filter>(() => FILTERS.includes(route.query.filter as Filter) ? route.query.filter as Filter : "all");
const page = computed(() => Math.max(1, Number(route.query.page) || 1));
const total = computed(() => Object.values(totals.value).reduce((a, b) => a + (b ?? 0), 0));
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
/** 頁碼列：頭尾、目前這頁前後各一頁，其餘收成「…」 */
const pageList = computed<(number | "gap")[]>(() => {
  const n = pageCount.value, cur = page.value;
  const keep = new Set([1, n, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= n));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - last > 1) out.push("gap");
    out.push(p);
    last = p;
  }
  return out;
});
function navigate(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) if (typeof v === "string" && v && !(k === "page" && v === "1") && !(k === "filter" && v === "all")) query[k] = v;
  void router.replace({ query });
}
/** 搜尋框：停手 300 ms 才查，換關鍵字回到第一頁 */
const draft = ref(q.value);
let typing: ReturnType<typeof setTimeout> | undefined;
watch(draft, (value) => {
  clearTimeout(typing);
  typing = setTimeout(() => { if (value.trim() !== q.value) navigate({ q: value.trim() || undefined, page: undefined }); }, 300);
});
watch(q, (value) => { if (value !== draft.value.trim()) draft.value = value; });
function goPage(p: number) {
  navigate({ page: String(p) });
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
}
const quotaLeft = computed(() => quota.value ? remaining(quota.value) : 0);
const packLeft = computed(() => quota.value?.packRemaining ?? 0);
// 免費額度跟補充包都用完才鎖；免費用完但還有包，登記照走（服務端會扣包）
const quotaFull = computed(() => !!quota.value && quotaLeft.value === 0 && packLeft.value === 0);
const quotaRange = computed(() => quota.value ? weekRange(quota.value, String(locale.value)) : null);
const quotaResetText = computed(() => !quota.value ? "" : daysUntilReset(quota.value)<=1 ? t("mine.quota.resetSoon") : t("mine.quota.reset",{n:daysUntilReset(quota.value)}));
/** 額度那一行只放數字與重置；週起訖與還剩幾張收在提示裡（數字跟三格已經看得出剩多少） */
const quotaHint = computed(() => !quotaRange.value ? "" : `${t("mine.quota.range", quotaRange.value)} · ${quotaLeft.value === 0 ? t("mine.quota.full") : t("mine.quota.left", { n: quotaLeft.value })}`);
let generation=0;
async function loadProvider(provider:ProviderId, version=generation) {
 try {
  const identity=session.profile?.identities.find(i=>i.provider===provider);
  const token=await accountToken(provider,identity?.externalId);
  if(!token)throw new Error("connection_source_expired");
  const result=await fetchMyCards(token,{provider,page:page.value,pageSize:PAGE_SIZE,fresh:true,q:q.value,filter:filter.value});
  if(version!==generation)return;
  rows.value[provider]=result.items;
  totals.value[provider]=result.total ?? result.items.length;
  quota.value=result.quota;delete failures.value[provider];delete reauth.value[provider];
 }catch(e){if(version===generation){failures.value[provider]=connectionMessage(e);reauth.value[provider]=needsReauthorization(e);}}
}
// 授權掉了就在原地重新授權，授權完回到這一頁；不要叫人去別的頁面找入口。
async function reconnect(provider:ProviderId){
 try{await connectAccount(provider,route.fullPath);}catch(e){failures.value[provider]=connectionMessage(e);}
}
/** 這個分頁上次看到的自己的卡：回到這頁先畫它，背景照常重讀（fresh）再換上 */
// 身分還在背景確認時（見 router 的 optimisticAuth）用上次登入的帳號與預設供應商找上次那份
const shownKey=()=>`${session.me?.accountNumId??signedInHint()??''}:${(providers.value.length?providers.value:[currentProvider()]).join(',')}:${filter.value}:${page.value}:${q.value}`;
async function load(quiet=false) {
 if(!providers.value.length)return;
 if(!quiet)loading.value=true;
 const version=generation;
 await Promise.all(providers.value.map(p=>loadProvider(p,version)));
 if(version!==generation)return;
 loading.value=false;
 if(!Object.keys(failures.value).length)lastShown.set(shownKey(),{rows:rows.value,totals:totals.value,quota:quota.value});
}
async function cardToken(card:WorkspaceCard) {
 const provider=card.sourceProvider??card.provider;
 const token=await accountToken(provider,session.profile?.identities.find(i=>i.provider===provider)?.externalId);
 if(!token)throw new Error(t("auth.expired"));
 return token;
}
/** 取消登記（下架）。送審與重新送審在編輯頁。撤了要重新送審才回得來，所以先問一聲。 */
async function withdraw(card: WorkspaceCard) {
  if (!card.sourceAvailable || !card.registered) return;
  const ok = await confirmDialog({
    title: t("mine.withdraw.title", { name: card.name }),
    message: t("mine.withdraw.message"),
    confirmText: t("mine.action.unregister"),
    danger: true,
  });
  if (!ok) return;
  busy.value = workKey(card);
  error.value = "";
  // Keep the displayed card while the original provider handles the request.
  card.registered = false;
  try {
    const token = await cardToken(card);
    if (!token) throw new Error(t("auth.expired"));
    await unregisterCard(card.roleId, token, card.provider);
    card.status = undefined;
    card.note = "";
    persistCard(card);
  } catch (err) {
    card.registered = true;
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}

function persistCard(card:WorkspaceCard) {
 const original=rows.value[card.provider]?.find(c=>c.roleId===card.roleId);
 if(original)Object.assign(original,card);
}
watch(()=>[session.me?.accountNumId,providers.value.join(','),q.value,filter.value,page.value],()=>{
 generation++;failures.value={};
 // 看過這一頁（同一個人、同樣的搜尋與篩選）就先畫上次那份，重讀不讓畫面變淡；沒看過才等伺服器
 const shown=(session.me||signedInHint())?lastShown.get(shownKey()):undefined;
 if(shown){rows.value=shown.rows;totals.value=shown.totals;quota.value=shown.quota;loading.value=false;}
 void load(!!shown);
},{immediate:true});
watch(()=>route.query.fresh, fresh=>{
 if(fresh!=="1")return;
 void load();
 const {fresh:_,...query}=route.query;void router.replace({query});
});
</script>

<template>
  <div class="page">
    <!--
      頁首只有一列：左邊標題與本週額度，右邊兩種開始寫卡的方式並排（AI Agent 在前、主鍵「建立新卡」在最右）。
      手機上主鍵留在標題右邊，AI Agent 換到額度下面撐滿整列，跟底下的搜尋框、卡片牆同一條左右邊
      （owner 2026-10-05：原本 AI Agent 膠囊單獨擺在標題上方，跟標題、額度卡、搜尋框各是一種寬度，對不齊）。
    -->
    <header class="head">
      <div class="head__text">
        <h1 class="head__title display">{{ $t("mine.title") }}</h1>
        <!-- 額度從一整張卡收成一行：數字、三格、幾天後重置；週起訖與還剩幾張在提示裡 -->
        <p class="quota" :class="{ 'quota--full': quotaFull }" :title="quotaHint || undefined" aria-live="polite">
          <template v-if="quota && quotaRange">
            <span class="quota__label">{{ quotaLeft === 0 ? $t("mine.quota.full") : $t("mine.quota.eyebrow") }}</span>
            <span class="quota__num"><strong>{{ quota.used }}</strong>/{{ quota.limit }} {{ $t("mine.quota.unit") }}</span>
            <span class="quota__pips" aria-hidden="true"><i v-for="i in quota.limit" :key="i" class="quota__pip" :class="{ 'quota__pip--on': i <= quota.used }" /></span>
            <span class="quota__reset">{{ quotaResetText }}</span>
            <span v-if="packLeft > 0" class="quota__packs" data-quota-packs>{{ $t("mine.quota.packs", { n: packLeft }) }}</span>
          </template>
        </p>
      </div>
      <div v-if="can('editor')" class="head__actions">
        <AgentOnboard from="mine" class="head__agent" />
        <RouterLink :to="lp('/create')" class="btn btn--primary head__create">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>{{ $t("mine.create") }}
        </RouterLink>
      </div>
    </header>

    <!-- 找卡：搜尋卡名或簡介（繁簡互通）、全部／已提交（含審核中、未通過）／未提交 -->
    <div class="tools">
      <label class="tools__search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M13 13l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <span class="sr-only">{{ $t("mine.search.label") }}</span>
        <input v-model="draft" type="search" class="input" :placeholder="$t('mine.search.placeholder')" maxlength="100" enterkeyhint="search" />
      </label>
      <div class="seg tools__seg" role="group" :aria-label="$t('mine.filter.label')">
        <button v-for="f in FILTERS" :key="f" type="button" class="seg__item" :class="{ 'seg__item--on': filter === f }" :aria-pressed="filter === f" @click="navigate({ filter: f, page: undefined })">{{ $t(`mine.filter.${f}`) }}</button>
      </div>
    </div>

    <div v-for="(message, provider) in failures" :key="provider" class="notice notice--error" role="alert">
      {{ providerName(provider as ProviderId) }} · {{ message }}
      <button v-if="reauth[provider]" class="btn btn--sm btn--primary" @click="reconnect(provider as ProviderId)">{{ $t('me.reauthorize') }}</button>
      <button v-else class="btn btn--sm" :disabled="loading" @click="load()">{{ $t('linked.retry') }}</button>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div v-if="loading && !visible.length" class="wall" aria-hidden="true">
      <div v-for="i in 12" :key="i" class="ghost ghost--card" />
    </div>

    <div v-else-if="!visible.length && !Object.keys(failures).length && (q || filter !== 'all')" class="empty panel">
      <p class="empty__title">{{ q ? $t("mine.searchEmpty", { q }) : $t("mine.filterEmpty") }}</p>
      <button type="button" class="btn" @click="draft = ''; navigate({ q: undefined, filter: undefined, page: undefined })">{{ $t("mine.clearFilters") }}</button>
    </div>

    <!-- 還沒有卡：指向寫卡指南的三種開始方式；AI Agent 那顆按鈕已在頁首，這裡不放第二顆 -->
    <div v-else-if="!visible.length && !Object.keys(failures).length" class="empty panel">
      <p class="empty__title">{{ $t("mine.empty.title") }}</p>
      <p class="empty__body">{{ $t("mine.empty.body") }}</p>
      <div class="empty__actions">
        <RouterLink :to="lp('/guide')" class="btn">{{ $t("mine.empty.guide") }}</RouterLink>
        <RouterLink v-if="can('editor')" :to="lp('/create')" class="btn btn--primary">{{ $t("mine.create") }}</RouterLink>
      </div>
    </div>

    <!-- 卡片牆跟首頁同一套欄數：手機兩欄、平板三到四欄、桌機六欄（都整除一頁 24 張，最後一列不缺角） -->
    <div v-else class="wall" :aria-busy="loading || undefined">
      <MyCardTile
        v-for="(card, i) in visible"
        :key="workKey(card)"
        :card="card"
        :busy="busy === workKey(card)"
        :eager="i < 6"
        @toggle="withdraw(card)"
      />
    </div>

    <nav v-if="pageCount > 1" class="pager" :aria-label="$t('mine.pages')">
      <button type="button" class="btn btn--sm pager__step" :disabled="page <= 1" :aria-label="$t('pager.prev')" @click="goPage(page - 1)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg><span class="pager__label">{{ $t("pager.prev") }}</span>
      </button>
      <template v-for="(p, i) in pageList" :key="i">
        <span v-if="p === 'gap'" class="subtle pager__gap">…</span>
        <button v-else type="button" class="btn btn--sm pager__num" :class="{ 'pager__num--on': p === page }" :aria-current="p === page ? 'page' : undefined" @click="goPage(p)">{{ p }}</button>
      </template>
      <button type="button" class="btn btn--sm pager__step" :disabled="page >= pageCount" :aria-label="$t('pager.next')" @click="goPage(page + 1)">
        <span class="pager__label">{{ $t("pager.next") }}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5" /></svg>
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* ── 頁首：標題＋額度一塊、兩顆開始寫卡的鍵一塊；放不下時鍵換到下一列並撐滿 ── */
.head {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: var(--s-3) var(--s-5); margin-bottom: var(--s-4);
}
.head__text { flex: 1 1 auto; min-width: 0; display: grid; gap: 6px; }
.head__title { font-size: clamp(20px, 2.6vw, 24px); margin: 0; }
.head__actions { display: flex; align-items: center; gap: var(--s-2); flex: none; }
.head__create { gap: 6px; padding-inline: var(--s-4) var(--s-5); }
.head__create svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
/* 兩顆鍵一樣高：膠囊本身是 min-height，主鍵是 height */
.head__actions .btn, .head__agent :deep(.onboard__pill) { min-height: var(--h-md); }

/* 本週額度：一行，放不下就整段換行（段與段之間只靠間距分開，換行後下一行開頭不會掛著分隔點）。
   滿了（免費與補充包都沒了）標題轉成提醒色、三格轉灰 */
.quota { margin: 0; min-height: 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--s-3); font-size: 12.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.quota > * { white-space: nowrap; }
.quota__label { color: var(--text-2); }
.quota__num { color: var(--text-2); }
.quota__num strong { color: var(--text); font-weight: 700; }
.quota__pips { display: inline-flex; gap: 3px; }
.quota__pip { width: 14px; height: 6px; border-radius: 999px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line-strong); }
.quota__pip--on { background: var(--accent-grad); box-shadow: none; }
.quota__packs { font-weight: 600; color: var(--accent-text); }
.quota--full .quota__label { color: var(--danger); font-weight: 600; }
.quota--full .quota__pip--on { background: var(--text-3); }

/* ── 搜尋與篩選：同一列；手機上各自撐滿 ── */
.tools { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); align-items: center; margin-bottom: var(--s-4); }
.tools__search { position: relative; flex: 0 1 360px; min-width: 0; }
.tools__search svg { position: absolute; left: var(--s-3); top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.tools__search .input { width: 100%; padding-left: calc(var(--s-3) * 2 + 16px); border-radius: var(--r-pill); }

/* ── 卡片牆：欄數照首頁（CardGrid）2／3／4／6，同一排的卡等高，操作列對齊 ── */
.wall { display: grid; gap: var(--s-4) var(--s-3); grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 600px) { .wall { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-5) var(--s-4); } }
@media (min-width: 820px) { .wall { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 1080px) { .wall { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.ghost--card { aspect-ratio: 3 / 6.9; }

.pager { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--s-2); margin-top: var(--s-6); }
.pager__step { gap: 2px; }
.pager__step svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pager__num { min-width: 36px; justify-content: center; font-variant-numeric: tabular-nums; }
.pager__num--on { background: var(--accent-tint); border-color: transparent; color: var(--accent-text); }
.pager__gap { padding: 0 var(--s-1); }

.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-4); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
.empty__body { margin: calc(-1 * var(--s-2)) 0 0; font-size: 14px; color: var(--text-2); }
.empty__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--s-2); }

/*
 * ── 手機：標題｜建立新卡 一列、額度一列、AI Agent 撐滿一列；搜尋與篩選各一列撐滿；翻頁只留箭頭 ──
 * 兩顆鍵擠一列在 360px 寬、英文或日文時膠囊會折成兩行，所以 AI Agent 自己一整列（五種語言都放得下）。
 */
@media (max-width: 599px) {
  .head {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
    grid-template-areas: "title create" "quota quota" "agent agent"; gap: var(--s-2) var(--s-3);
  }
  .head__text, .head__actions { display: contents; }
  .head__title { grid-area: title; }
  .quota { grid-area: quota; margin-top: calc(-1 * var(--s-1)); }
  .head__create { grid-area: create; }
  .head__agent { grid-area: agent; display: flex; margin-top: var(--s-1); }
  .head__agent :deep(.onboard__pill) { flex: 1; justify-content: center; }
  .tools__search { flex: 1 1 100%; }
  .tools__seg { flex: 1 1 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tools__seg .seg__item { padding-inline: var(--s-2); }
  .pager { gap: var(--s-1); }
  .pager__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .pager__num, .pager__step { min-width: 36px; padding-inline: var(--s-2); justify-content: center; }
}
/* 手指點的裝置：頁首兩顆鍵與翻頁鍵撐到 44px */
@media (pointer: coarse) {
  .head__actions .btn, .head__agent :deep(.onboard__pill) { min-height: var(--h-lg); }
  .head__create { height: var(--h-lg); }
  .pager .btn { height: var(--h-lg); min-width: var(--h-lg); }
}
</style>
