<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { can } from "@/lib/provider";
import { fetchPublicCampaigns, localized, type CampaignSummary } from "@/lib/campaign";
import { fetchUpdates } from "@/lib/updates";
import { fetchPosts, postPath } from "@/lib/blog";
import { withLocale } from "@/router";
import { useSiteLinks } from "@/lib/site-links";
import { sidebarPosition, type SidebarPosition } from "@/lib/sidebar-position";
import SiteLink from "./SiteLink.vue";

const session = useSession();
const { locale, lp } = useLocalePath();
const { support } = useSiteLinks();
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

const host = ref<HTMLElement | null>(null);
const sidebar = ref<HTMLElement | null>(null);
let clearanceFrame = 0;
let sizeObserver: ResizeObserver | undefined;
let position: SidebarPosition | undefined;
function scheduleClearance() { if (!clearanceFrame) clearanceFrame = requestAnimationFrame(measureClearance); }
// Scroll already runs before paint. Deferring its transform to another RAF exposes
// the natural document movement for a frame, then snaps the pinned rail back.
function scrollClearance() { cancelAnimationFrame(clearanceFrame); measureClearance(); }
function measureClearance() {
  clearanceFrame = 0;
  const outer = host.value, inner = sidebar.value;
  if (!outer || !inner) return;
  const tokens = getComputedStyle(document.documentElement);
  const header = parseFloat(tokens.getPropertyValue('--site-header-h')) || parseFloat(tokens.getPropertyValue('--header-h')) || 60;
  const bottomLimit = window.innerHeight - (parseFloat(getComputedStyle(inner).scrollMarginBottom) || 80);
  const natural = outer.getBoundingClientRect();
  const height = inner.offsetHeight;
  position = sidebarPosition({ scrollY: window.scrollY, naturalTop: natural.top, height,
    parentHeight: outer.offsetHeight, top: header + 24, bottom: bottomLimit }, position);
  inner.style.transform = `translateY(${position.offset}px)`;
}
function revealFocus(event: FocusEvent) {
  const target = event.target as HTMLElement;
  requestAnimationFrame(() => {
    const rect = target.getBoundingClientRect();
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-header-h')) || 60;
    const delta = rect.top < header + 24 ? rect.top - header - 24 : rect.bottom > innerHeight - 80 ? rect.bottom - innerHeight + 80 : 0;
    if (delta) { window.scrollBy({ top: delta, behavior: 'instant' }); scheduleClearance(); }
  });
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && host.value && sidebar.value) {
    sizeObserver = new ResizeObserver(scheduleClearance); sizeObserver.observe(host.value); sizeObserver.observe(sidebar.value);
  }
  window.addEventListener('scroll', scrollClearance, { passive: true });
  window.addEventListener('resize', scheduleClearance);
  scheduleClearance();
});
onUpdated(scheduleClearance);
onBeforeUnmount(() => {
  cancelAnimationFrame(clearanceFrame); sizeObserver?.disconnect();
  window.removeEventListener('scroll', scrollClearance); window.removeEventListener('resize', scheduleClearance);
  live = false; latestEpoch++;
});
</script>

<template>
  <div ref="host" class="home-sidebar-host"><aside ref="sidebar" class="home-sidebar" :aria-label="$t('home.siteInfo')" @focusin="revealFocus">
    <section class="panel sidebar-block" data-sidebar-campaigns>
      <h2 class="sidebar-label"><svg class="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5" /></svg><span>{{ $t('home.eventsTitle') }}</span></h2>
      <div v-if="campaignState === 'loading'" class="ghost sidebar-skeleton" aria-hidden="true" />
      <template v-else-if="campaignState === 'error'"><p role="alert">{{ $t('home.activityError') }}</p><button class="btn btn--sm" @click="loadCampaigns">{{ $t('home.retry') }}</button></template>
      <RouterLink v-else-if="running[0]" class="sidebar-title" :to="lp(`/campaign/${running[0].slug}`)">{{ localized(running[0].title, locale) }}</RouterLink>
      <p v-else class="muted">{{ $t('home.noEvents') }}</p>
      <RouterLink class="sidebar-link sidebar-link--accent" :to="lp('/campaigns')"><span>{{ $t('campaign.hub.title') }}</span><svg class="sidebar-icon sidebar-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></RouterLink>
    </section>
    <section class="panel sidebar-block" data-sidebar-latest>
      <h2 class="sidebar-label"><svg class="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /></svg><span>{{ $t('home.latestTitle') }}</span></h2>
      <div v-if="latestState === 'loading'" class="ghost sidebar-skeleton" aria-hidden="true" />
      <template v-else-if="latestState === 'error'"><p role="alert">{{ $t('home.latestError') }}</p><button class="btn btn--sm" @click="loadLatest">{{ $t('home.retry') }}</button></template>
      <RouterLink v-else-if="latest" class="sidebar-title" :to="latest.to">{{ latest.title }}</RouterLink>
      <template v-else><p class="muted">{{ $t('home.noUpdates') }}</p><RouterLink class="sidebar-link" :to="lp('/blog')">{{ $t('blog.title') }}</RouterLink></template>
      <RouterLink class="sidebar-link" :to="lp('/updates')">{{ $t('home.allUpdates') }}</RouterLink>
    </section>
    <section v-if="can('editor')" class="panel sidebar-block sidebar-invite">
      <h2 class="sidebar-label"><svg class="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg><span>{{ $t('home.writeTitle') }}</span></h2>
      <RouterLink class="btn sidebar-create" :class="{ 'btn--primary': session.me }" :to="lp('/create')">{{ $t('home.write') }}</RouterLink>
      <RouterLink class="sidebar-link" :to="lp('/guide')"><span>{{ $t('footer.guide') }}</span><svg class="sidebar-icon sidebar-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></RouterLink>
      <RouterLink v-if="season" class="sidebar-link" :to="lp(`/campaign/${season.slug}`)"><span>{{ localized(season.title, locale) }}</span><svg class="sidebar-icon sidebar-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></RouterLink>
    </section>
    <nav id="home-site-info" tabindex="-1" class="sidebar-info" :aria-label="$t('home.siteInfo')"><SiteLink v-for="link in support" :key="link.id" :link="link" /></nav>
  </aside></div>
</template>

<style scoped>
.home-sidebar-host { align-self: stretch; min-width: 0; }
.home-sidebar :deep(a), .home-sidebar button { scroll-margin-top: calc(var(--site-header-h, var(--header-h)) + var(--s-5)); }
.home-sidebar { align-self: start; scroll-margin-bottom: calc(80px + env(safe-area-inset-bottom, 0px)); display: grid; gap: var(--s-4); align-content: start; overflow: visible; padding-block: var(--s-1); }
.sidebar-block { padding: var(--s-4); min-width: 0; display: grid; gap: var(--s-2); }
.sidebar-block h2 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.sidebar-label { display: flex; align-items: center; gap: var(--s-2); }
.sidebar-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.sidebar-label .sidebar-icon { color: var(--accent-text); }
.sidebar-chevron { width: 14px; height: 14px; }
.sidebar-block p { font-size: 13px; margin: 0; overflow-wrap: anywhere; }
.sidebar-title { display: block; font-size: 15px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; min-height: var(--h-sm); }
[data-sidebar-latest] .sidebar-title { font-size: 14px; font-weight: 500; }
.sidebar-title:hover, .sidebar-link:hover { color: var(--accent-text); }
.sidebar-link { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); min-height: var(--h-sm); font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.sidebar-link > span { min-width: 0; }
.sidebar-link--accent { color: var(--accent-text); }
.sidebar-invite { background: var(--accent-tint); }
.sidebar-create { width: 100%; white-space: normal; height: auto; min-height: var(--h-md); text-align: center; }
.sidebar-checkin-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-3); }
.sidebar-state { display: flex; align-items: center; gap: var(--s-2); color: var(--text-2); }
.sidebar-state i { width: 6px; height: 6px; flex: none; border-radius: var(--r-pill); background: var(--accent-btn); }
.sidebar-state--done i { background: var(--text-3); }
.sidebar-balance { display: grid; gap: var(--s-1); font-size: 12px; }
.sidebar-balance--divided { margin-top: var(--s-1); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.sidebar-score { justify-content: flex-start; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; line-height: 1.15; color: var(--text); }
.sidebar-skeleton { height: 44px; margin: var(--s-2) 0; }
.sidebar-info { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); line-height: 1.5; font-size: 12px; color: var(--text-3); padding: 0 var(--s-2); }
.sidebar-info :deep(a), .sidebar-info :deep(button) { display: inline-flex; align-items: center; min-height: 30px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: start; overflow-wrap: anywhere; }
.sidebar-info :deep(a:hover), .sidebar-info :deep(button:hover) { color: var(--text); }
:lang(ko) { word-break: keep-all; overflow-wrap: anywhere; }
</style>
