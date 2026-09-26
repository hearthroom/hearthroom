<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, fetchMyCards, registerCard, unregisterCard, type MyCard, type MyCardPage } from "@/lib/api";
import { confirmChoice } from "@/lib/confirm";
import { daysUntilReset, remaining, weekRange } from "@/lib/quota";
import { useLocalePath } from "@/lib/use-locale";
import { groupWorks, workKey, type WorkspaceCard } from "@/lib/card-workspace";
import MyCardTile from "@/components/MyCardTile.vue";

import { useSession } from "@/lib/session";
import { connectionMessage } from "@/lib/distribution";
import { can, currentProvider, providerName, type ProviderId } from "@/lib/provider";
import { accountToken, connectAccount, needsReauthorization } from "@/lib/connections";
import { lastShown } from "@/lib/mine-memory";
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
const notice = ref("");
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
const quotaFull = computed(() => !!quota.value && quotaLeft.value === 0);
const quotaRange = computed(() => quota.value ? weekRange(quota.value, String(locale.value)) : null);
const quotaResetText = computed(() => !quota.value ? "" : daysUntilReset(quota.value)<=1 ? t("mine.quota.resetSoon") : t("mine.quota.reset",{n:daysUntilReset(quota.value)}));
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
/**
 * 提交審核（登記）。
 *
 * 按下去之前先把話說清楚：提交等於把這張卡的完整設定授權給本站的審核帳號唯讀。
 * 這是作者的意思表示，服務端用他自己的 token 去主站授權，所以確認框不能省。
 */
async function submit(card: WorkspaceCard) {
  if (!card.sourceAvailable) return;
  if (!card.registered && quotaFull.value) {
    error.value = t("mine.quota.exceeded");
    return;
  }
  // 提交時必須宣告分級，而且刻意不預選：這是作者親手做的聲明，審核人會對照內容，不符會被駁回
  const rating = await confirmChoice({
    title: t("mine.consent.title"),
    message: t("workspace.reviewConsent"),
    confirmText: t("mine.consent.confirm"),
    choiceLabel: t("mine.rating.label"),
    choices: [
      { value: "sfw", label: t("mine.rating.sfw"), hint: t("mine.rating.sfwHint") },
      { value: "nsfw", label: t("mine.rating.nsfw"), hint: t("mine.rating.nsfwHint") },
    ],
  });
  if (!rating) return;
  const nsfw = rating === "nsfw";
  const wasRegistered = card.registered;
  busy.value = workKey(card);
  error.value = "";
  notice.value = "";
  try {
    const token = await cardToken(card);
    // Community review is one publication. Platform distribution is an explicit, separate choice.
    const res = await registerCard(card.roleId, token, nsfw, [], card.provider);
    card.registered = true;
    card.updateStatus = wasRegistered && res.status==='approved' ? 'pending' : undefined;
    card.status = res.status === "unlisted" ? undefined : res.status ?? "approved";
    card.note = "";
    card.nsfw = nsfw;

    // 登記成功就多用掉一格；撤銷不還——額度數的是「這週登記過幾張不同的卡」
    if (!wasRegistered && quota.value) quota.value.used = Math.min(quota.value.limit, quota.value.used + 1);
    notice.value = t("mine.submitted");
    persistCard(card);
  } catch (err) {
    error.value =
      err instanceof ApiError && err.code === "weekly_quota_exceeded"
        ? t("mine.quota.exceeded")
        : err instanceof ApiError && err.code === "card_too_large_for_review"
        ? t("mine.tooLargeForReview")
        : err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}

async function toggle(card: WorkspaceCard) {
  if (!card.sourceAvailable) return;
  if (!card.registered) return submit(card);
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
    <header class="head">
      <div class="head__text">
        <h1 class="head__title display">{{ $t("mine.title") }}</h1>
        <p class="subtle">{{ $t("workspace.hint") }}</p>
      </div>
      <RouterLink v-if="can('editor')" :to="lp('/create')" class="btn btn--primary">{{ $t("mine.create") }}</RouterLink>
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

    <!-- 找卡：搜尋卡名或簡介（繁簡互通）、全部／已上架／未上架 -->
    <div class="tools">
      <label class="tools__search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M13 13l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <span class="sr-only">{{ $t("mine.search.label") }}</span>
        <input v-model="draft" type="search" class="input" :placeholder="$t('mine.search.placeholder')" maxlength="100" enterkeyhint="search" />
      </label>
      <div class="seg" role="group" :aria-label="$t('mine.filter.label')">
        <button v-for="f in FILTERS" :key="f" type="button" class="seg__item" :class="{ 'seg__item--on': filter === f }" :aria-pressed="filter === f" @click="navigate({ filter: f, page: undefined })">{{ $t(`mine.filter.${f}`) }}</button>
      </div>
    </div>

    <div v-for="(message, provider) in failures" :key="provider" class="notice notice--error" role="alert">
      {{ providerName(provider as ProviderId) }} · {{ message }}
      <button v-if="reauth[provider]" class="btn btn--sm btn--primary" @click="reconnect(provider as ProviderId)">{{ $t('me.reauthorize') }}</button>
      <button v-else class="btn btn--sm" :disabled="loading" @click="load()">{{ $t('linked.retry') }}</button>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="notice" role="status">{{ notice }}</p>

    <div v-if="loading && !visible.length" class="wall" aria-hidden="true">
      <div v-for="i in 12" :key="i" class="ghost ghost--card" />
    </div>

    <div v-else-if="!visible.length && !Object.keys(failures).length && (q || filter !== 'all')" class="empty panel">
      <p class="empty__title">{{ q ? $t("mine.searchEmpty", { q }) : $t("mine.filterEmpty") }}</p>
      <button type="button" class="btn" @click="draft = ''; navigate({ q: undefined, filter: undefined, page: undefined })">{{ $t("mine.clearFilters") }}</button>
    </div>

    <div v-else-if="!visible.length && !Object.keys(failures).length" class="empty panel">
      <p class="empty__title">{{ $t("mine.empty") }}</p>
      <RouterLink v-if="can('editor')" :to="lp('/create')" class="btn btn--primary">{{ $t("mine.empty.cta") }}</RouterLink>
    </div>


    <div v-else class="wall" :aria-busy="loading || undefined">
      <MyCardTile
        v-for="card in visible"
        :key="workKey(card)"
        :card="card"
        :locked="quotaFull"
        :busy="busy === workKey(card)"
        @toggle="toggle(card)"
        @resubmit="submit(card)"
      />
    </div>

    <nav v-if="pageCount > 1" class="pager" :aria-label="$t('mine.pages')">
      <button type="button" class="btn btn--sm" :disabled="page <= 1" @click="goPage(page - 1)">← {{ $t("pager.prev") }}</button>
      <template v-for="(p, i) in pageList" :key="i">
        <span v-if="p === 'gap'" class="subtle pager__gap">…</span>
        <button v-else type="button" class="btn btn--sm pager__num" :class="{ 'pager__num--on': p === page }" :aria-current="p === page ? 'page' : undefined" @click="goPage(p)">{{ p }}</button>
      </template>
      <button type="button" class="btn btn--sm" :disabled="page >= pageCount" @click="goPage(page + 1)">{{ $t("pager.next") }} →</button>
    </nav>
  </div>
</template>

<style scoped>
.head .btn { min-height:44px; }
.create-platform {max-width:100%} .create-platform a {margin:var(--s-2)}
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

.tools { display:flex; flex-wrap:wrap; gap:var(--s-3); align-items:center; margin-bottom:var(--s-4); }
.tools__search { position:relative; flex:1 1 240px; max-width:420px; }
.tools__search svg { position:absolute; left:var(--s-3); top:50%; width:16px; height:16px; transform:translateY(-50%); color:var(--text-3); pointer-events:none; }
.tools__search .input { width:100%; padding-left:calc(var(--s-3) * 2 + 16px); border-radius:var(--r-pill); }
.pager { display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:var(--s-2); margin-top:var(--s-5); }
.pager__num { min-width:36px; justify-content:center; font-variant-numeric:tabular-nums; }
.pager__num--on { background:var(--accent-tint); border-color:transparent; color:var(--accent-text); }
.pager__gap { padding:0 var(--s-1); }
.wall { display:grid; gap:var(--s-4); grid-template-columns:minmax(0,320px); justify-content:center; align-items:start; }
@media(min-width:600px){.wall{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:900px){.wall{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(min-width:1200px){.wall{grid-template-columns:repeat(4,minmax(0,1fr))}}
.ghost--card { aspect-ratio: 2 / 3.7; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-4); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
</style>
