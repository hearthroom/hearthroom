<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { can } from "@/lib/provider";
import { whole } from "@/lib/format";
import { fetchPublicCampaigns, localized, type CampaignSummary } from "@/lib/campaign";
import { fetchPanel, RewardsError } from "@/lib/rewards";
import { fetchWallet } from "@/lib/api";
import { fetchUpdates } from "@/lib/updates";
import { fetchPosts, postPath } from "@/lib/blog";
import { withLocale } from "@/router";
import { useSiteLinks } from "@/lib/site-links";
import SiteLink from "./SiteLink.vue";

const session = useSession();
const { locale, lp } = useLocalePath();
const { links } = useSiteLinks();
const campaigns = ref<CampaignSummary[]>([]);
const campaignState = ref("loading");
const running = computed(() => campaigns.value.filter(c => c.phase === "open").sort((a, b) => (a.featuredRank ?? Infinity) - (b.featuredRank ?? Infinity) || (a.startsAt ?? 0) - (b.startsAt ?? 0)));
const season = computed(() => running.value.find(c => c.kind === "card_reward"));
let live = true;
async function loadCampaigns() {
  campaignState.value = "loading";
  try { const result = await fetchPublicCampaigns(); if (!Array.isArray(result.items)) throw new Error("campaigns_shape"); if (live) { campaigns.value = result.items; campaignState.value = "ready"; } }
  catch { if (live) campaignState.value = "error"; }
}
void loadCampaigns();

const latest = ref<{ title: string; to: string } | null>(null);
const latestState = ref("loading");
let latestEpoch = 0;
async function loadLatest() {
  const epoch = ++latestEpoch;
  const lang = locale.value;
  latestState.value = "loading"; latest.value = null;
  try {
    const response = await fetchUpdates(lang, "full");
    if (!live || epoch !== latestEpoch) return;
    const update = response.items.filter(item => item.audience === "everyone" || session.me).sort((a, b) => b.announcedAt - a.announcedAt)[0];
    let value = update ? { title: update.title, to: `${lp('/updates')}#${update.id}` } : null;
    if (!update) {
      const posts = await fetchPosts({}, 1, lang);
      const post = [...posts.pinned, ...posts.items].sort((a, b) => (b.groupPublishedAt ?? b.firstPublishedAt ?? 0) - (a.groupPublishedAt ?? a.firstPublishedAt ?? 0))[0];
      if (post) value = { title: post.title, to: withLocale(postPath(post), post.locale) };
    }
    if (live && epoch === latestEpoch) { latest.value = value; latestState.value = "ready"; }
  } catch { if (live && epoch === latestEpoch) latestState.value = "error"; }
}
watch([locale, () => !!session.me], loadLatest, { immediate: true });

// These reads belong to the current member. The shared check-in panel is not
// account-scoped, so a late response must not become another member's status.
const balance = ref<number | null>(null);
const balanceState = ref("loading");
const checkinState = ref("loading");
const claimed = ref(false);
let memberEpoch = 0;
async function loadBalance(epoch = memberEpoch) {
  balanceState.value = "loading";
  try {
    const token = await session.accessToken();
    if (!live || epoch !== memberEpoch) return;
    if (!token) throw new Error("auth");
    const wallet = await fetchWallet(token);
    if (!Number.isFinite(wallet.score) || !Number.isFinite(wallet.tempScore)) throw new Error("wallet_shape");
    if (live && epoch === memberEpoch) { balance.value = wallet.score + wallet.tempScore; balanceState.value = "ready"; }
  } catch { if (live && epoch === memberEpoch) { balance.value = null; balanceState.value = "error"; } }
}
async function loadCheckin(epoch = memberEpoch) {
  checkinState.value = "loading";
  try {
    const token = await session.accessToken();
    if (!live || epoch !== memberEpoch) return;
    if (!token) throw new Error("auth");
    const panel = await fetchPanel(token);
    if (live && epoch === memberEpoch) { claimed.value = panel.checkin.todayClaimed; checkinState.value = "ready"; }
  } catch (err) {
    if (live && epoch === memberEpoch) checkinState.value = err instanceof RewardsError && err.code === "rewards_disabled" ? "disabled" : "error";
  }
}
watch(() => session.me?.accountNumId, id => {
  const epoch = ++memberEpoch;
  balance.value = null; claimed.value = false;
  balanceState.value = checkinState.value = "loading";
  if (id) { void loadBalance(epoch); void loadCheckin(epoch); }
}, { immediate: true });
onBeforeUnmount(() => { live = false; memberEpoch++; latestEpoch++; });
</script>

<template>
  <aside class="home-sidebar" :aria-label="$t('home.siteInfo')">
    <section class="panel sidebar-block" data-sidebar-campaigns>
      <h2>{{ $t('home.eventsTitle') }}</h2>
      <div v-if="campaignState === 'loading'" class="ghost sidebar-skeleton" aria-hidden="true" />
      <template v-else-if="campaignState === 'error'"><p role="alert">{{ $t('home.activityError') }}</p><button class="btn btn--sm" @click="loadCampaigns">{{ $t('home.retry') }}</button></template>
      <RouterLink v-else-if="running[0]" class="sidebar-title" :to="lp(`/campaign/${running[0].slug}`)">{{ localized(running[0].title, locale) }}</RouterLink>
      <p v-else class="muted">{{ $t('home.noEvents') }}</p>
      <RouterLink class="sidebar-link" :to="lp('/campaigns')">{{ $t('campaign.hub.title') }}</RouterLink>
    </section>
    <section v-if="can('editor')" class="panel sidebar-block">
      <h2>{{ $t('home.writeTitle') }}</h2>
      <RouterLink class="sidebar-link" :to="lp('/create')">{{ $t('home.write') }}</RouterLink>
      <RouterLink class="sidebar-link" :to="lp('/guide')">{{ $t('footer.guide') }}</RouterLink>
      <RouterLink v-if="season" class="sidebar-link" :to="lp(`/campaign/${season.slug}`)">{{ localized(season.title, locale) }}</RouterLink>
    </section>
    <section v-if="session.me" class="panel sidebar-block" data-sidebar-member>
      <template v-if="checkinState !== 'disabled'">
        <h2>{{ $t('home.dailyTitle') }}</h2>
        <div v-if="checkinState === 'loading'" class="ghost sidebar-skeleton" aria-hidden="true" />
        <template v-else-if="checkinState === 'error'"><p role="alert">{{ $t('home.checkinError') }}</p><button class="btn btn--sm" @click="loadCheckin()">{{ $t('home.retry') }}</button></template>
        <template v-else><p>{{ $t(claimed ? 'home.claimed' : 'home.pending') }}</p><RouterLink class="sidebar-link" :to="lp('/checkin')">{{ $t(claimed ? 'home.checkinDoneAction' : 'home.checkinAction') }}</RouterLink></template>
      </template>
      <div data-sidebar-balance class="sidebar-balance">
        <span class="muted">{{ $t('wallet.balance') }}</span>
        <div v-if="balanceState === 'loading'" class="ghost sidebar-skeleton" aria-hidden="true" />
        <template v-else-if="balanceState === 'error'"><p role="alert">{{ $t('home.balanceError') }}</p><button class="btn btn--sm" @click="loadBalance()">{{ $t('home.retry') }}</button></template>
        <RouterLink v-else-if="balance !== null" class="sidebar-link stat" :to="lp('/wallet')">{{ whole(balance) }}</RouterLink>
      </div>
    </section>
    <section class="panel sidebar-block" data-sidebar-latest>
      <h2>{{ $t('home.latestTitle') }}</h2>
      <div v-if="latestState === 'loading'" class="ghost sidebar-skeleton" aria-hidden="true" />
      <template v-else-if="latestState === 'error'"><p role="alert">{{ $t('home.latestError') }}</p><button class="btn btn--sm" @click="loadLatest">{{ $t('home.retry') }}</button></template>
      <RouterLink v-else-if="latest" class="sidebar-title" :to="latest.to">{{ latest.title }}</RouterLink>
      <template v-else><p class="muted">{{ $t('home.noUpdates') }}</p><RouterLink class="sidebar-link" :to="lp('/blog')">{{ $t('blog.title') }}</RouterLink></template>
    </section>
    <nav id="home-site-info" tabindex="-1" class="sidebar-info" :aria-label="$t('home.siteInfo')"><SiteLink v-for="link in links" :key="link.id" :link="link" /></nav>
  </aside>
</template>

<style scoped>
.home-sidebar { display: grid; gap: var(--s-4); align-content: start; position: sticky; top: calc(var(--site-header-h, var(--header-h)) + var(--s-5)); max-height: calc(100dvh - var(--site-header-h, var(--header-h)) - var(--s-6)); overflow-y: auto; scrollbar-width: thin; overscroll-behavior: contain; }
.sidebar-block { padding: var(--s-4); min-width: 0; }
.sidebar-block h2 { margin: 0 0 var(--s-2); font-size: 16px; font-weight: 600; }
.sidebar-block p { font-size: 13px; margin: var(--s-2) 0; overflow-wrap: anywhere; }
.sidebar-title { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; min-height: 30px; }
.sidebar-title:hover, .sidebar-link:hover { color: var(--accent-text); }
.sidebar-link { display: flex; align-items: center; min-height: 30px; font-size: 13px; }
.sidebar-balance { margin-top: var(--s-3); font-size: 13px; }
.sidebar-balance .stat { font-size: 18px; }
.sidebar-skeleton { height: 44px; margin: var(--s-2) 0; }
.sidebar-info { display: flex; flex-wrap: wrap; gap: 0 var(--s-3); font-size: 12px; color: var(--text-3); padding: 0 var(--s-2); }
.sidebar-info :deep(a), .sidebar-info :deep(button) { display: inline-flex; align-items: center; min-height: 30px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: start; overflow-wrap: anywhere; }
.sidebar-info :deep(a:hover), .sidebar-info :deep(button:hover) { color: var(--text); }
:lang(ko) { word-break: keep-all; overflow-wrap: anywhere; }
</style>
