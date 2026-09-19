<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, fetchMeAt, fetchMyCards, registerCard, unregisterCard, type MyCard, type MyCardPage } from "@/lib/api";
import { confirmChoice } from "@/lib/confirm";
import { daysUntilReset, remaining, weekRange } from "@/lib/quota";
import { useLocalePath } from "@/lib/use-locale";
import { groupWorks, workKey, type WorkspaceCard } from "@/lib/card-workspace";
import MyCardTile from "@/components/MyCardTile.vue";

import { useSession } from "@/lib/session";
import { connectionMessage } from "@/lib/distribution";
import { apiBaseOf, can, currentProvider, providerName, type ProviderId } from "@/lib/provider";
import { accountToken } from "@/lib/connections";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t, locale } = useI18n();

const emails=ref<Partial<Record<ProviderId,string>>>({});
const rows = ref<Partial<Record<ProviderId, MyCard[]>>>({});
const pages = ref<Partial<Record<ProviderId, number>>>({});
const more = ref<Partial<Record<ProviderId, boolean>>>({});
const failures = ref<Partial<Record<ProviderId, string>>>({});
const quota = ref<MyCardPage["quota"] | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref<string | null>(null);
const providers = computed(() => session.profile?.identities.map(i=>i.provider as ProviderId) ?? (session.me ? [currentProvider()] : []));
const visible = computed(()=>groupWorks(rows.value));
const hasNext = computed(()=>Object.values(more.value).some(Boolean));
const quotaLeft = computed(() => quota.value ? remaining(quota.value) : 0);
const quotaFull = computed(() => !!quota.value && quotaLeft.value === 0);
const quotaRange = computed(() => quota.value ? weekRange(quota.value, String(locale.value)) : null);
const quotaResetText = computed(() => !quota.value ? "" : daysUntilReset(quota.value)<=1 ? t("mine.quota.resetSoon") : t("mine.quota.reset",{n:daysUntilReset(quota.value)}));
let generation=0;
async function loadProvider(provider:ProviderId, append=false, version=generation) {
 try {
  const identity=session.profile?.identities.find(i=>i.provider===provider);
  const token=await accountToken(provider,identity?.externalId);
  if(!token)throw new Error("connection_source_expired");
  const page=append?(pages.value[provider]??0)+1:1;
  if(!append) {const me=await fetchMeAt(apiBaseOf(provider),token).catch(()=>null);if(version===generation && me?.email)emails.value[provider]=me.email;}
  const result=await fetchMyCards(token,{provider,page,fresh:true});
  if(version!==generation)return;
  rows.value[provider]=append?[...(rows.value[provider]??[]),...result.items]:result.items;
  pages.value[provider]=page;more.value[provider]=result.hasNext;
  quota.value=result.quota;delete failures.value[provider];
 }catch(e){if(version===generation)failures.value[provider]=connectionMessage(e);}
}
async function load(append=false) {
 if(!providers.value.length)return;
 loading.value=true;
 const version=generation;
 await Promise.all(providers.value.filter(p=>!append||more.value[p]||failures.value[p]).map(p=>loadProvider(p,append,version)));
 if(version===generation)loading.value=false;
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
    message: t(card.provider==='harbor'?"workspace.reviewConsent":"mine.consent.message"),
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
watch(()=>[session.me?.accountNumId,providers.value.join(',')],()=>{
 generation++;emails.value={};rows.value={};pages.value={};more.value={};failures.value={};quota.value=null;
 void load();
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

    <div v-for="(message, provider) in failures" :key="provider" class="notice notice--error" role="alert">
      {{ providerName(provider as ProviderId) }} · {{ message }}
      <button class="btn btn--sm" :disabled="loading" @click="load()">{{ $t('linked.retry') }}</button>
      <RouterLink :to="lp('/me')">{{ $t('me.reauthorize') }}</RouterLink>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="notice" role="status">{{ notice }}</p>

    <div v-if="loading && !visible.length" class="wall" aria-hidden="true">
      <div v-for="i in 12" :key="i" class="ghost ghost--card" />
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
        :emails="emails"
        :busy="busy === workKey(card)"
        @toggle="toggle(card)"
        @resubmit="submit(card)"
      />
    </div>

    <div v-if="hasNext" class="pager">
      <button class="btn" :disabled="loading" @click="load(true)">{{ $t(loading?'linked.loading':'workspace.more') }}</button>
    </div>
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

.wall { display:grid; gap:var(--s-5); grid-template-columns:minmax(0,1fr); align-items:start; }
@media(min-width:640px){.wall{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:1080px){.wall{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ghost--card { aspect-ratio: 3 / 5.4; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-4); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
</style>
