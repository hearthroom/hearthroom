<script setup lang="ts">
/**
 * 首頁看板頂端的輪播：推薦到首頁的活動在前，原本的蘇綺（插槽，內容不動）固定排最後。
 * 一開始停在第一個活動：活動比歡迎卡重要（owner 2026-10-17：分享季 → 創作季 → 蘇綺卡）。
 *
 * 活動從公開列表挑：推薦到首頁、進行中或即將開始，照活動設定的排序值，最多三個（featuredCampaigns）。
 * 一個都沒有就只畫插槽，外層全部 display: contents，跟沒有輪播時一模一樣；活動的程式碼等首頁畫好才下載。
 * 幾張疊在同一格裡淡入淡出，高度由最高的那張決定（通常是蘇綺那張，活動卡比它高時蘇綺跟著撐滿）：換張時版面不跳。
 * 沒有蘇綺時活動卡自己撐高度，跟歡迎橫幅一樣高。
 *
 * 活動之後最多再接一張文章：置頂中、30 天內發布的最新一篇（homePost），關聯的活動已經在輪播裡就不放。
 *
 * 每 7 秒換一張，進度條顯示這張還剩多久。滑鼠在上面、焦點在裡面、分頁在背景時暫停，進度停住不歸零；
 * 手指碰過之後 10 秒內不自己換（正在點蘇綺的選項時不被換走），之後恢復；系統設定減少動態時不自己換。
 * 進度條與左右鍵（寬螢幕）可以手動換，手機可以左右滑。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { LOCALES } from "@/lib/i18n";
import type { PostCard } from "@/lib/blog";
import type { CampaignSummary } from "@/lib/campaign";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ hero: boolean; campaigns: boolean; tourHero?: boolean }>();
const { t } = useI18n();
const { lp, locale } = useLocalePath();

type CampaignLib = typeof import("@/lib/campaign");
const INTERVAL = 7000;
/** 手指最後一次碰到之後多久恢復自己換 */
const TOUCH_RESUME = 10_000;
const SWIPE = 40;

const lib = shallowRef<CampaignLib | null>(null);
const featured = ref<CampaignSummary[]>([]);
const post = ref<PostCard | null>(null);
const postColumn = ref("");
const campaignsReady = ref(false);
let postSeq = 0;
onMounted(async () => {
  try {
    const m = await import("@/lib/campaign");
    const { items } = await m.fetchPublicCampaigns();
    featured.value = m.featuredCampaigns(items);
    lib.value = m;
  } catch { /* 讀不到就只有蘇綺 */ }
  campaignsReady.value = true;
});
watch([locale, campaignsReady, () => props.campaigns], async () => {
  const mine = ++postSeq;
  const lang = locale.value;
  post.value = null;
  if (!campaignsReady.value || !props.campaigns) return;
  try {
    const b = await import("@/lib/blog");
    const { pinned } = await b.fetchPosts({}, 1, lang);
    const pick = b.homePost(pinned, featured.value.map((c) => c.slug), Date.now());
    if (!pick || mine !== postSeq) return;
    // 欄目名讀不到就寫「官方」，卡片照樣出現
    const name = await b.fetchColumns()
      .then(({ items }) => b.columnName(b.allColumns(items).find((c) => c.slug === pick.columnSlug), lang, ""))
      .catch(() => "") || t("blog.official");
    if (mine !== postSeq) return;
    postPath.value = b.postPath(pick);
    postColumn.value = name;
    post.value = pick;
  } catch { /* 讀不到就沒有文章卡 */ }
});
const postPath = ref("");

const slides = computed(() => {
  const m = lib.value;
  if (!m || !props.campaigns) return [];
  return featured.value.map((c) => {
    const title = m.localized(c.title, locale.value) || c.slug;
    return { slug: c.slug, phase: c.phase, bannerUrl: c.bannerUrl, poster: c.posterUrls?.[locale.value], title, parts: titleParts(title), period: m.formatShortPeriod(c, locale.value) };
  });
});
/**
 * 活動名兩行時在品牌名後的空格斷（「SukiSuki／創作シーズン」）：品牌名與活動名各自不換行。
 * 只在兩段都夠短時這樣做，太長的照一般規則換行，不讓一段字撐出卡片。
 */
function titleParts(title: string): string[] {
  const at = title.indexOf(" ");
  if (at <= 0) return [title];
  const parts = [title.slice(0, at), title.slice(at + 1)];
  return parts.every((p) => [...p].length <= 16) ? parts : [title];
}
const on = computed(() => slides.value.length > 0 || !!post.value);
/** 蘇綺那張排在最後：活動、文章之後 */
const heroAt = computed(() => slides.value.length + (post.value ? 1 : 0));
const count = computed(() => heroAt.value + (props.hero ? 1 : 0));

const pause = reactive({ hover: false, focus: false, hidden: false, touched: false });
/** 第一張就是第一個活動（沒有活動時是文章或蘇綺），永遠是 0 */
const index = ref(0);
// 活動或文章晚一步讀到、蘇綺出現或收起來：張數對應變了，回到第一張（碰過也一樣，否則序號會指到別張）
watch([() => slides.value.length, () => !!post.value, () => props.hero], () => { index.value = 0; });
watch(count, (n) => { if (index.value >= n) index.value = 0; });
// 導覽正在介紹蘇綺面板裡的按鈕時，讓目標留在可見的那張；活動晚到也一樣。
watch([() => props.tourHero, heroAt, () => props.hero], () => {
  if (props.tourHero && props.hero) index.value = heroAt.value;
}, { immediate: true, flush: "post" });
const go = (i: number) => { if (!props.tourHero || !props.hero) index.value = (i + count.value) % count.value; };

const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const auto = computed(() => count.value > 1 && !reduced);
const running = computed(() => auto.value && !(props.tourHero && props.hero) && !pause.touched && !pause.hover && !pause.focus && !pause.hidden);
/**
 * 這張還剩多久：暫停時記下剩下的，恢復時接著倒數（進度條停住不歸零，見 CSS 的 animation-play-state）。
 * 換張（自己換或手動換）都重新給滿 7 秒，進度條換到新的那一段從頭填。
 */
let timer: ReturnType<typeof setTimeout> | undefined;
/** 現在這張還剩多久；startedAt 是這次開始倒數的時刻，沒在倒數時是 null */
let remaining = INTERVAL, startedAt: number | null = null;
function arm() {
  clearTimeout(timer);
  startedAt = Date.now();
  timer = setTimeout(() => go(index.value + 1), remaining);
}
function hold() {
  clearTimeout(timer);
  if (startedAt !== null) remaining = Math.max(0, remaining - (Date.now() - startedAt));
  startedAt = null;
}
watch(index, () => { hold(); remaining = INTERVAL; if (running.value) arm(); });
watch(running, (now) => { if (now) arm(); else hold(); }, { immediate: true });

let touchTimer: ReturnType<typeof setTimeout> | undefined;
/** 手指碰到：先停，最後一次碰到之後 10 秒恢復 */
function touched() {
  pause.touched = true;
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => { pause.touched = false; }, TOUCH_RESUME);
}

const onVisibility = () => { pause.hidden = document.hidden; };
onMounted(() => { onVisibility(); document.addEventListener("visibilitychange", onVisibility); });
onBeforeUnmount(() => { ++postSeq; clearTimeout(timer); clearTimeout(touchTimer); document.removeEventListener("visibilitychange", onVisibility); });

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
  touched();
  const p = e.touches[0];
  start = p && on.value ? { x: p.clientX, y: p.clientY, scroller: inScroller(e.target) } : null;
}
function onTouchEnd(e: TouchEvent) {
  const p = e.changedTouches[0];
  touched();
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
      <div
        v-for="(c, i) in slides" :key="c.slug" class="carousel__slide" :class="{ 'carousel__slide--on': index === i, 'carousel__slide--poster': !!c.poster }"
        v-bind="slideAttrs(i)" :data-slide="c.slug"
      >
        <RouterLink class="carousel__card" :class="{ 'carousel__card--banner': !c.poster && c.bannerUrl, 'carousel__card--poster': !!c.poster }" :to="lp(`/campaign/${c.slug}`)" @click="clicked(c.slug)">
          <img v-if="c.poster || c.bannerUrl" class="carousel__img" :src="c.poster?.url || c.bannerUrl!" :alt="c.poster?.alt || ''" decoding="async" />
          <svg v-else class="carousel__mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c1.6 9.6 10.4 18.4 20 20-9.6 1.6-18.4 10.4-20 20-1.6-9.6-10.4-18.4-20-20 9.6-1.6 18.4-10.4 20-20z" /></svg>
          <span v-if="!c.poster" class="carousel__body">
            <span class="carousel__phase" :class="`carousel__phase--${c.phase}`">{{ t(`campaign.phase.${c.phase}`) }}</span>
            <strong class="carousel__title"><template v-for="(part, k) in c.parts" :key="k"><template v-if="k">{{ " " }}</template><span :class="{ carousel__part: c.parts.length > 1 }">{{ part }}</span></template></strong>
            <span v-if="c.period" class="carousel__period">{{ c.period }}</span>
            <span class="btn btn--primary carousel__cta">{{ t("campaign.carousel.cta") }}</span>
          </span>
        </RouterLink>
      </div>
      <div
        v-if="post" class="carousel__slide" :class="{ 'carousel__slide--on': index === slides.length }"
        v-bind="slideAttrs(slides.length)" :data-slide="`post:${post.slug}`"
      >
        <RouterLink class="carousel__card" :class="{ 'carousel__card--banner': post.coverUrl }" :to="lp(postPath)" @click="clicked(`post:${post.slug}`)">
          <img v-if="post.coverUrl" class="carousel__img" :src="post.coverUrl" alt="" decoding="async" />
          <svg v-else class="carousel__mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c1.6 9.6 10.4 18.4 20 20-9.6 1.6-18.4 10.4-20 20-1.6-9.6-10.4-18.4-20-20 9.6-1.6 18.4-10.4 20-20z" /></svg>
          <span class="carousel__body">
            <span class="carousel__phase carousel__phase--post">{{ postColumn }}<span v-if="post.fallback" :lang="post.locale"> · {{ LOCALES.find(l=>l.code===post?.locale)?.label ?? post.locale }}</span></span>
            <strong class="carousel__title">{{ post.title }}</strong>
            <span class="btn btn--primary carousel__cta">{{ t("blog.carousel.read") }}</span>
          </span>
        </RouterLink>
      </div>
      <div v-show="hero" class="carousel__slide carousel__hero" :class="{ 'carousel__slide--on': index === heroAt }" v-bind="slideAttrs(heroAt)">
        <slot />
      </div>
    </div>

    <div v-if="on && count > 1" class="carousel__controls">
      <button type="button" class="btn btn--ghost btn--icon btn--sm carousel__arrow" :aria-label="t('campaign.carousel.prev')" data-prev @click="go(index - 1)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5.5L7.5 10l4.5 4.5" /></svg>
      </button>
      <!-- 每張一段進度條：看過的填滿，現在這張 7 秒內填滿（暫停時停住），還沒到的空著 -->
      <div class="carousel__dots" :class="{ 'carousel__dots--auto': auto, 'carousel__dots--paused': !running }">
        <button
          v-for="n in count" :key="n" type="button" class="carousel__dot"
          :class="{ 'carousel__dot--on': index === n - 1, 'carousel__dot--seen': n - 1 < index }"
          :aria-label="label(n - 1)" :aria-current="index === n - 1 ? 'true' : undefined" data-dot @click="go(n - 1)"
        ><span :key="index === n - 1 ? `on-${index}` : 'off'" class="carousel__bar" /></button>
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
/* 每張一樣高（桌機 220、手機 176）：換張時版面不跳；蘇綺那張比較高時大家跟著撐滿 */
.carousel--on .carousel__slide { min-height: 220px; }

.carousel__card {
  position: relative; overflow: hidden; isolation: isolate;
  display: flex; flex-direction: column; justify-content: center;
  border-radius: var(--r-lg); box-shadow: 0 0 0 1px var(--line);
  color: var(--text); text-decoration: none;
}
/* 沒有橫幅圖：強調色從左邊淡進來，右邊一組同心環當主視覺，空出來的那一側是刻意的 */
.carousel__card:not(.carousel__card--banner):not(.carousel__card--poster) {
  background:
    radial-gradient(42% 90% at 82% 50%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    linear-gradient(100deg, color-mix(in srgb, var(--accent) 14%, var(--surface)) 0%, var(--accent-tint) 38%, var(--surface) 100%);
}
.carousel__card:not(.carousel__card--banner):not(.carousel__card--poster)::before,
.carousel__card:not(.carousel__card--banner):not(.carousel__card--poster)::after {
  content: ""; position: absolute; z-index: -1; top: 50%; border-radius: var(--r-pill); pointer-events: none; transform: translateY(-50%);
}
.carousel__card:not(.carousel__card--banner):not(.carousel__card--poster)::before {
  right: 4%; width: 440px; aspect-ratio: 1; border: 44px solid color-mix(in srgb, var(--accent) 9%, transparent);
}
.carousel__card:not(.carousel__card--banner):not(.carousel__card--poster)::after {
  right: calc(4% + 96px); width: 248px; aspect-ratio: 1; border: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 14%, transparent), transparent);
}
.carousel__mark { position: absolute; z-index: -1; top: 50%; right: calc(4% + 180px); width: 80px; height: 80px; transform: translateY(-50%); fill: color-mix(in srgb, var(--accent) 55%, transparent); }

/* 有橫幅圖：圖鋪滿，左邊與下緣壓暗讓白字讀得到 */
.carousel__img { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; background: var(--surface-2); }
.carousel__card--poster .carousel__img { object-position: 50% 50%; object-fit: contain; }
/* Pure artwork keeps its complete embedded copy; interactive hero slots retain their content height. */
.carousel--on .carousel__slide--poster { height: clamp(112px, 15vw, 224px); min-height: 0; align-self: center; }
.carousel__card--banner { color: #fff; }
.carousel__card--banner::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background:
    linear-gradient(90deg, rgba(14, 10, 18, 0.78) 0%, rgba(14, 10, 18, 0.5) 40%, rgba(14, 10, 18, 0) 66%),
    linear-gradient(0deg, rgba(14, 10, 18, 0.4) 0%, rgba(14, 10, 18, 0) 55%);
}

/* 文字區：桌機左側 560 寬、垂直置中，每張一樣；右半是橫幅的安全框（蘇綺的臉），不放字、不壓暗 */
.carousel__body { width: min(560px, 60%); padding: var(--s-5) 3.5%; display: grid; gap: var(--s-2); justify-items: start; }
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
/* strict：長音符與小假名不落行首；品牌名與活動名各自不換行（carousel__part），兩行時在中間的空格斷 */
.carousel__title {
  font-size: 30px; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere; line-break: strict;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.carousel__part { white-space: nowrap; }
.carousel__period { font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.carousel__card--banner .carousel__period { color: rgba(255, 255, 255, 0.86); }
.carousel__cta { margin-top: var(--s-2); height: var(--h-lg); padding: 0 var(--s-5); font-size: 15px; font-weight: 600; }
.carousel__card:hover .carousel__cta { filter: brightness(0.95); }

.carousel__controls { display: flex; align-items: center; justify-content: center; gap: var(--s-1); margin-top: var(--s-2); }
.carousel__arrow svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
/* 進度條：每張一段 28×4。看過的填滿；現在這段在 7 秒內填滿（跟換張的計時同長），暫停時停住；不自己換時現在這段直接填滿 */
.carousel__dots { display: flex; }
.carousel__dot { position: relative; width: 36px; height: 24px; padding: 0; display: grid; place-items: center; border: 0; background: transparent; cursor: pointer; }
.carousel__dot::before { content: ""; width: 28px; height: 4px; border-radius: var(--r-pill); background: var(--border-strong); transition: background var(--dur) var(--ease); }
.carousel__dot:hover::before { background: var(--text-3); }
.carousel__bar { position: absolute; top: 50%; left: 4px; width: 0; height: 4px; border-radius: var(--r-pill); background: var(--accent); transform: translateY(-50%); pointer-events: none; }
.carousel__dot--seen .carousel__bar, .carousel__dot--on .carousel__bar { width: 28px; }
.carousel__dots--auto .carousel__dot--on .carousel__bar { animation: carousel-fill 7s linear forwards; }
.carousel__dots--paused .carousel__dot--on .carousel__bar { animation-play-state: paused; }
@keyframes carousel-fill { from { width: 0; } to { width: 28px; } }

/* 手機：跟蘇綺面板同一個斷點。字縮一階，左右鍵收起來（用滑的） */
@media (prefers-reduced-motion: reduce) { .carousel__dots--auto .carousel__dot--on .carousel__bar { animation: none; } }

@media (max-width: 760px) {
  .carousel--on .carousel__slide { min-height: 176px; }
  .carousel--on .carousel__slide--poster { min-height: 0; }
  /* 文字區從左 16 到卡寬 55%、一律貼底 16：每張的字在同一個位置，右邊留給橫幅的安全框 */
  .carousel__body { width: 55%; max-width: none; box-sizing: border-box; padding: var(--s-4); padding-right: 0; gap: var(--s-1); }
  .carousel__mark { display: none; }
  /* 手機卡比較窄：橫幅取偏右的位置，蘇綺留在畫面裡 */
  .carousel__img { object-position: 70% 50%; }
  .carousel__card--banner::before { background: linear-gradient(90deg, rgba(14, 10, 18, 0.82) 0%, rgba(14, 10, 18, 0.55) 40%, rgba(14, 10, 18, 0) 66%); }
  .carousel__card { justify-content: flex-end; }
  .carousel__card:not(.carousel__card--banner):not(.carousel__card--poster)::before { right: -110px; width: 260px; border-width: 28px; }
  .carousel__card:not(.carousel__card--banner):not(.carousel__card--poster)::after { right: -50px; width: 140px; }
  .carousel__phase { height: 22px; }
  .carousel__title { font-size: 18px; }
  /* 期間在手機上只佔一行，太長的時區名稱收成省略號 */
  .carousel__period { max-width: 100%; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .carousel__cta { margin-top: var(--s-1); height: var(--h-sm); padding: 0 var(--s-4); font-size: 13px; }
  .carousel__arrow { display: none; }
  .carousel__controls { margin-top: var(--s-1); }
  .carousel__dot { width: 32px; height: 28px; }
  .carousel__bar { left: 2px; }
}
</style>
