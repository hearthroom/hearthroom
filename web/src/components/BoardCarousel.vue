<script setup lang="ts">
/**
 * 首頁看板頂端的輪播：第一張是原本的蘇綺（插槽，內容不動），後面接推薦到首頁的活動。
 * 有活動時一開始停在第一個活動、蘇綺排在輪換裡：活動比歡迎卡重要（owner 2026-10-17）。
 *
 * 活動從公開列表挑：推薦到首頁、進行中或即將開始，進行中的在前，最多三個（featuredCampaigns）。
 * 一個都沒有就只畫插槽，外層全部 display: contents，跟沒有輪播時一模一樣；活動的程式碼等首頁畫好才下載。
 * 幾張疊在同一格裡淡入淡出，高度由最高的那張決定（通常是蘇綺那張，活動卡比它高時蘇綺跟著撐滿）：換張時版面不跳。
 * 沒有蘇綺時活動卡自己撐高度，跟歡迎橫幅一樣高。
 *
 * 活動之後最多再接一張文章：置頂中、30 天內發布的最新一篇（homePost），關聯的活動已經在輪播裡就不放。
 *
 * 每 7 秒換一張。滑鼠在上面、焦點在裡面、分頁在背景時暫停；手指碰過就不再自己換（正在點蘇綺的選項時不被換走）；
 * 系統設定減少動態時不自己換。圓點與左右鍵（寬螢幕）可以手動換，手機可以左右滑。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import type { PostCard } from "@/lib/blog";
import type { CampaignSummary } from "@/lib/campaign";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ hero: boolean; campaigns: boolean }>();
const { t } = useI18n();
const { lp, locale } = useLocalePath();

type CampaignLib = typeof import("@/lib/campaign");
const INTERVAL = 7000;
const SWIPE = 40;

const lib = shallowRef<CampaignLib | null>(null);
const featured = ref<CampaignSummary[]>([]);
const post = ref<PostCard | null>(null);
const postColumn = ref("");
onMounted(async () => {
  try {
    const m = await import("@/lib/campaign");
    const { items } = await m.fetchPublicCampaigns();
    featured.value = m.featuredCampaigns(items);
    lib.value = m;
  } catch { /* 讀不到就只有蘇綺 */ }
  if (!props.campaigns) return;
  try {
    const b = await import("@/lib/blog");
    const { pinned } = await b.fetchPosts({}, 1);
    const pick = b.homePost(pinned, featured.value.map((c) => c.slug), Date.now());
    if (!pick) return;
    postPath.value = b.postPath(pick);
    // 欄目名讀不到就寫「官方」，卡片照樣出現
    postColumn.value = await b.fetchColumns()
      .then(({ items }) => b.columnName(b.allColumns(items).find((c) => c.slug === pick.columnSlug), locale.value, ""))
      .catch(() => "") || t("blog.official");
    post.value = pick;
  } catch { /* 讀不到就沒有文章卡 */ }
});
const postPath = ref("");

const slides = computed(() => {
  const m = lib.value;
  if (!m || !props.campaigns) return [];
  return featured.value.map((c) => ({ slug: c.slug, phase: c.phase, bannerUrl: c.bannerUrl, title: m.localized(c.title, locale.value) || c.slug, period: m.formatPeriod(c, locale.value) }));
});
const on = computed(() => slides.value.length > 0 || !!post.value);
const offset = computed(() => (props.hero ? 1 : 0));
const count = computed(() => offset.value + slides.value.length + (post.value ? 1 : 0));

const pause = reactive({ hover: false, focus: false, hidden: false, touched: false });
/** 起始那張：有活動就是第一個活動，沒有就是蘇綺（或文章） */
const first = computed(() => (slides.value.length ? offset.value : 0));
const index = ref(0);
// 活動晚一步讀到：還沒被碰過就跳到活動那張
watch(first, (i) => { if (!pause.touched) index.value = i; });
// 蘇綺出現或收起來時張數的對應會錯開一張：回到起始那張
watch(() => props.hero, () => { index.value = first.value; });
watch(count, (n) => { if (index.value >= n) index.value = first.value; });
const go = (i: number) => { index.value = (i + count.value) % count.value; };

const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const running = computed(() => count.value > 1 && !reduced && !pause.touched && !pause.hover && !pause.focus && !pause.hidden);
let timer: ReturnType<typeof setTimeout> | undefined;
// 手動換張也重新計時：剛換上的那張一樣看滿 7 秒
watch([running, index], () => {
  clearTimeout(timer);
  if (running.value) timer = setTimeout(() => go(index.value + 1), INTERVAL);
}, { immediate: true });

const onVisibility = () => { pause.hidden = document.hidden; };
onMounted(() => { onVisibility(); document.addEventListener("visibilitychange", onVisibility); });
onBeforeUnmount(() => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); });

const root = ref<HTMLElement | null>(null);
function onFocusOut(e: FocusEvent) {
  if (!root.value?.contains(e.relatedTarget as Node | null)) pause.focus = false;
}

/** 從會橫向捲動的地方（蘇綺面板手機版的選項列）開始的滑動是在捲那一列，不換張 */
function inScroller(el: EventTarget | null): boolean {
  for (let n = el as HTMLElement | null; n && n !== root.value; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}
let start: { x: number; y: number; scroller: boolean } | null = null;
function onTouchStart(e: TouchEvent) {
  pause.touched = true;
  const p = e.touches[0];
  start = p && on.value ? { x: p.clientX, y: p.clientY, scroller: inScroller(e.target) } : null;
}
function onTouchEnd(e: TouchEvent) {
  const p = e.changedTouches[0];
  if (!start || !p || start.scroller) { start = null; return; }
  const dx = p.clientX - start.x, dy = p.clientY - start.y;
  start = null;
  if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) go(index.value + (dx < 0 ? 1 : -1));
}

const label = (n: number) => t("campaign.carousel.slide", { n: n + 1, m: count.value });
/** 沒在畫面上的那幾張：讀屏跳過、Tab 走不進去 */
const slideAttrs = (n: number) => (on.value ? {
  role: "group", "aria-roledescription": "slide", "aria-label": label(n),
  "aria-hidden": index.value === n ? undefined : true, inert: index.value === n ? undefined : true,
} : {});
const clicked = (slug: string) => track("cta", { detail: "carousel", subject: slug });
</script>

<template>
  <div
    ref="root" class="carousel" :class="{ 'carousel--on': on, 'carousel--bare': on && !hero }"
    v-bind="on ? { role: 'region', 'aria-roledescription': 'carousel', 'aria-label': t('campaign.carousel.label') } : {}"
    @mouseenter="pause.hover = true" @mouseleave="pause.hover = false"
    @focusin="pause.focus = true" @focusout="onFocusOut"
    @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd"
  >
    <div class="carousel__track" :aria-live="on ? (running ? 'off' : 'polite') : undefined">
      <div v-show="hero" class="carousel__slide carousel__hero" :class="{ 'carousel__slide--on': index === 0 }" v-bind="slideAttrs(0)">
        <slot />
      </div>
      <div
        v-for="(c, i) in slides" :key="c.slug" class="carousel__slide" :class="{ 'carousel__slide--on': index === i + offset }"
        v-bind="slideAttrs(i + offset)" :data-slide="c.slug"
      >
        <RouterLink class="carousel__card" :class="{ 'carousel__card--banner': c.bannerUrl }" :to="lp(`/campaign/${c.slug}`)" @click="clicked(c.slug)">
          <img v-if="c.bannerUrl" class="carousel__img" :src="c.bannerUrl" alt="" decoding="async" />
          <svg v-else class="carousel__mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c1.6 9.6 10.4 18.4 20 20-9.6 1.6-18.4 10.4-20 20-1.6-9.6-10.4-18.4-20-20 9.6-1.6 18.4-10.4 20-20z" /></svg>
          <span class="carousel__body">
            <span class="carousel__phase" :class="`carousel__phase--${c.phase}`">{{ t(`campaign.phase.${c.phase}`) }}</span>
            <strong class="carousel__title">{{ c.title }}</strong>
            <span v-if="c.period" class="carousel__period">{{ c.period }}</span>
            <span class="btn btn--primary carousel__cta">{{ t("campaign.carousel.cta") }}</span>
          </span>
        </RouterLink>
      </div>
      <div
        v-if="post" class="carousel__slide" :class="{ 'carousel__slide--on': index === slides.length + offset }"
        v-bind="slideAttrs(slides.length + offset)" :data-slide="`post:${post.slug}`"
      >
        <RouterLink class="carousel__card" :class="{ 'carousel__card--banner': post.coverUrl }" :to="lp(postPath)" @click="clicked(`post:${post.slug}`)">
          <img v-if="post.coverUrl" class="carousel__img" :src="post.coverUrl" alt="" decoding="async" />
          <svg v-else class="carousel__mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c1.6 9.6 10.4 18.4 20 20-9.6 1.6-18.4 10.4-20 20-1.6-9.6-10.4-18.4-20-20 9.6-1.6 18.4-10.4 20-20z" /></svg>
          <span class="carousel__body">
            <span class="carousel__phase carousel__phase--post">{{ postColumn }}</span>
            <strong class="carousel__title">{{ post.title }}</strong>
            <span class="btn btn--primary carousel__cta">{{ t("blog.carousel.read") }}</span>
          </span>
        </RouterLink>
      </div>
    </div>

    <div v-if="on && count > 1" class="carousel__controls">
      <button type="button" class="btn btn--ghost btn--icon btn--sm carousel__arrow" :aria-label="t('campaign.carousel.prev')" data-prev @click="go(index - 1)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5.5L7.5 10l4.5 4.5" /></svg>
      </button>
      <div class="carousel__dots">
        <button
          v-for="n in count" :key="n" type="button" class="carousel__dot" :class="{ 'carousel__dot--on': index === n - 1 }"
          :aria-label="label(n - 1)" :aria-current="index === n - 1 ? 'true' : undefined" data-dot @click="go(n - 1)"
        />
      </div>
      <button type="button" class="btn btn--ghost btn--icon btn--sm carousel__arrow" :aria-label="t('campaign.carousel.next')" data-next @click="go(index + 1)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 沒有活動：外層不成盒，插槽裡的蘇綺照原本的樣子排 */
.carousel:not(.carousel--on), .carousel:not(.carousel--on) > .carousel__track, .carousel:not(.carousel--on) .carousel__slide { display: contents; }

.carousel--on { margin-bottom: var(--s-4); }
.carousel--on .carousel__track { display: grid; }
.carousel--on .carousel__slide {
  grid-area: 1 / 1; min-width: 0; display: grid;
  opacity: 0; visibility: hidden;
  transition: opacity var(--dur-slow) var(--ease), visibility 0s linear var(--dur-slow);
}
.carousel--on .carousel__slide--on { z-index: 1; opacity: 1; visibility: visible; transition: opacity var(--dur-slow) var(--ease), visibility 0s; }
/* 蘇綺自己的下邊距交給輪播 */
.carousel--on .carousel__hero > :slotted(*) { margin-bottom: 0; }
/* 沒有蘇綺那張時活動卡自己撐高度（跟歡迎橫幅一樣高） */
.carousel--bare .carousel__slide { min-height: 220px; }

.carousel__card {
  position: relative; overflow: hidden; isolation: isolate;
  display: flex; flex-direction: column; justify-content: center;
  border-radius: var(--r-lg); box-shadow: 0 0 0 1px var(--line);
  color: var(--text); text-decoration: none;
}
/* 沒有橫幅圖：強調色從左邊淡進來，右邊一組同心環當主視覺，空出來的那一側是刻意的 */
.carousel__card:not(.carousel__card--banner) {
  background:
    radial-gradient(42% 90% at 82% 50%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    linear-gradient(100deg, color-mix(in srgb, var(--accent) 14%, var(--surface)) 0%, var(--accent-tint) 38%, var(--surface) 100%);
}
.carousel__card:not(.carousel__card--banner)::before,
.carousel__card:not(.carousel__card--banner)::after {
  content: ""; position: absolute; z-index: -1; top: 50%; border-radius: var(--r-pill); pointer-events: none; transform: translateY(-50%);
}
.carousel__card:not(.carousel__card--banner)::before {
  right: 4%; width: 440px; aspect-ratio: 1; border: 44px solid color-mix(in srgb, var(--accent) 9%, transparent);
}
.carousel__card:not(.carousel__card--banner)::after {
  right: calc(4% + 96px); width: 248px; aspect-ratio: 1; border: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 14%, transparent), transparent);
}
.carousel__mark { position: absolute; z-index: -1; top: 50%; right: calc(4% + 180px); width: 80px; height: 80px; transform: translateY(-50%); fill: color-mix(in srgb, var(--accent) 55%, transparent); }

/* 有橫幅圖：圖鋪滿，左邊與下緣壓暗讓白字讀得到 */
.carousel__img { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; background: var(--surface-2); }
.carousel__card--banner { color: #fff; }
.carousel__card--banner::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background:
    linear-gradient(90deg, rgba(14, 10, 18, 0.78) 0%, rgba(14, 10, 18, 0.5) 42%, rgba(14, 10, 18, 0) 72%),
    linear-gradient(0deg, rgba(14, 10, 18, 0.4) 0%, rgba(14, 10, 18, 0) 55%);
}

.carousel__body { max-width: min(560px, 60%); padding: var(--s-5) 3.5%; display: grid; gap: var(--s-2); justify-items: start; }
.carousel__phase {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
  border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2);
}
.carousel__phase::before { content: ""; width: 6px; height: 6px; border-radius: var(--r-pill); background: currentColor; }
.carousel__phase--open { background: var(--success-soft); color: var(--success); }
.carousel__phase--upcoming { background: var(--accent-soft); color: var(--accent-text); }
/* 文章卡標的是欄目，不是狀態：不帶狀態圓點 */
.carousel__phase--post::before { display: none; }
.carousel__card--banner .carousel__phase { background: rgba(255, 255, 255, 0.2); color: #fff; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.carousel__title {
  font-size: 30px; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.carousel__period { font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.carousel__card--banner .carousel__period { color: rgba(255, 255, 255, 0.86); }
.carousel__cta { margin-top: var(--s-2); height: var(--h-lg); padding: 0 var(--s-5); font-size: 15px; font-weight: 600; }
.carousel__card:hover .carousel__cta { filter: brightness(0.95); }

.carousel__controls { display: flex; align-items: center; justify-content: center; gap: var(--s-1); margin-top: var(--s-2); }
.carousel__arrow svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.carousel__dots { display: flex; }
.carousel__dot { width: 24px; height: 24px; padding: 0; display: grid; place-items: center; border: 0; background: transparent; cursor: pointer; }
.carousel__dot::before {
  content: ""; width: 6px; height: 6px; border-radius: var(--r-pill); background: var(--border-strong);
  transition: width var(--dur) var(--ease), background var(--dur) var(--ease);
}
.carousel__dot:hover::before { background: var(--text-3); }
.carousel__dot--on::before, .carousel__dot--on:hover::before { width: 18px; background: var(--accent); }

/* 手機：跟蘇綺面板同一個斷點。字縮一階，左右鍵收起來（用滑的） */
@media (max-width: 760px) {
  .carousel--bare .carousel__slide { min-height: 176px; }
  .carousel__body { max-width: none; padding: var(--s-4); gap: var(--s-1); }
  .carousel__mark { display: none; }
  .carousel__card--banner::before { background: linear-gradient(0deg, rgba(14, 10, 18, 0.82) 0%, rgba(14, 10, 18, 0.45) 60%, rgba(14, 10, 18, 0.2) 100%); }
  .carousel__card { justify-content: flex-end; }
  .carousel__card:not(.carousel__card--banner)::before { right: -110px; width: 260px; border-width: 28px; }
  .carousel__card:not(.carousel__card--banner)::after { right: -50px; width: 140px; }
  .carousel__phase { height: 22px; }
  .carousel__title { font-size: 18px; }
  /* 期間在手機上只佔一行，太長的時區名稱收成省略號 */
  .carousel__period { max-width: 100%; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .carousel__cta { margin-top: var(--s-1); height: var(--h-sm); padding: 0 var(--s-4); font-size: 13px; }
  .carousel__arrow { display: none; }
  .carousel__controls { margin-top: var(--s-1); }
  .carousel__dot { width: 20px; height: 28px; }
}
</style>
