<script setup lang="ts">
/**
 * 一篇官方文章：頁頭（欄目、標題、日期、閱讀時長、官方、封面）、內文、分享、上一篇／下一篇、相關文章、留言。
 * 關聯了活動的文章，頁頭下與文末各放一個活動區塊（BlogCampaign）。
 *
 * 內文跟文件頁同一個渲染（markdown-toc.ts，不吃 HTML）。目錄三項以上才放：桌面在側欄跟著捲動，
 * 手機收在標題下面。網址帶 ?preview= 是編輯器的預覽連結：讀得到還沒公開的版本，頁首說一聲，
 * 不記瀏覽、不放留言（還沒公開的文章沒有留言區），分享出去的網址也不帶預覽碼。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import BlogCampaign from "@/components/BlogCampaign.vue";
import BlogPostCard from "@/components/BlogPostCard.vue";
import CommentPanel from "@/components/CommentPanel.vue";
import GuestSignInSheet from "@/components/GuestSignInSheet.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import { ApiError } from "@/lib/api";
import { allColumns, columnName, fetchColumns, fetchPost, groupOfColumn, likePost, markViewed, postPath, viewPost, type BlogGroup, type Engagement, type PostPage } from "@/lib/blog";
import { dateOnly } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { renderDoc } from "@/lib/markdown-toc";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const route = useRoute();
const { t } = useI18n();
const { lp, locale } = useLocalePath();

const columnSlug = computed(() => String(route.params.column ?? ""));
const slug = computed(() => String(route.params.slug ?? ""));
const preview = computed(() => (typeof route.query.preview === "string" && route.query.preview) || undefined);

const data = ref<PostPage | null>(null);
const groups = ref<BlogGroup[]>([]);
const loading = ref(true);
const missing = ref(false);
const failed = ref(false);

const post = computed(() => data.value?.post ?? null);
const rendered = computed(() => renderDoc(post.value?.bodyMd ?? ""));
const longRead = computed(() => rendered.value.toc.length >= 3);
const column = computed(() => (post.value ? columnName(allColumns(groups.value).find((c) => c.slug === post.value!.columnSlug), locale.value, post.value.columnSlug) : ""));
const postGroup = computed(() => (post.value ? groupOfColumn(groups.value, post.value.columnSlug) : undefined));
const published = computed(() => post.value?.firstPublishedAt ?? post.value?.publishAt ?? null);
/** 跟發布不是同一天才說「更新於」：同一天改個錯字不必多一行 */
const updated = computed(() => {
  if (!post.value || !published.value) return null;
  const day = dateOnly(post.value.contentUpdatedAt / 1000);
  return day === dateOnly(published.value / 1000) ? null : day;
});
const columnOf = (s: string) => columnName(allColumns(groups.value).find((c) => c.slug === s), locale.value);

const article = ref<HTMLElement | null>(null);
const endEl = ref<HTMLElement | null>(null);
const activeId = ref("");
const tocOpen = ref(true);
let headingObserver: IntersectionObserver | undefined;
let endObserver: IntersectionObserver | undefined;

function observe() {
  headingObserver?.disconnect();
  endObserver?.disconnect();
  if (typeof IntersectionObserver === "undefined") return;
  const headings = longRead.value ? [...(article.value?.querySelectorAll<HTMLElement>("h2[id], h3[id]") ?? [])] : [];
  if (headings.length) {
    headingObserver = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) activeId.value = (hit.target as HTMLElement).id;
    }, { rootMargin: "-72px 0px -70% 0px", threshold: 0 });
    for (const h of headings) headingObserver.observe(h);
  }
  // 讀到文末：文末那一塊進到視窗裡記一次
  const end = endEl.value;
  const subject = post.value?.slug;
  if (end && subject && !preview.value) {
    let sent = false;
    endObserver = new IntersectionObserver((entries) => {
      if (sent || !entries.some((e) => e.isIntersecting)) return;
      sent = true;
      endObserver?.disconnect();
      track("blog_read_end", { subject });
    });
    endObserver.observe(end);
  }
}

/** 換文章時上一篇的回應晚到就丟掉 */
let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  missing.value = false;
  failed.value = false;
  try {
    const res = await fetchPost(columnSlug.value, slug.value, preview.value);
    if (mine !== seq) return;
    data.value = res;
    document.title = pageTitle(res.post.title);
    if (!preview.value) {
      track("blog_view", { subject: res.post.slug });
      void refreshStats(res.post.id);
    }
    await nextTick();
    observe();
  } catch (err) {
    if (mine !== seq) return;
    data.value = null;
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else failed.value = true;
  } finally {
    if (mine === seq) loading.value = false;
  }
}

// ---- 分享 --------------------------------------------------------------------
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
const shareUrl = computed(() => (post.value ? `${location.origin}${lp(postPath(post.value))}` : ""));
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = ""; }, 3000); }

// ---- 閱讀數與喜歡 ---------------------------------------------------------------

const session = useSession();
const stats = ref<Engagement | null>(null);
const signInOpen = ref(false);
const statsOf = (): Engagement => stats.value ?? { views: null, likes: 0, liked: false };
async function refreshStats(id: string) {
  stats.value = null;
  // 本地日期（sv 地區格式剛好是 YYYY-MM-DD）：同一個瀏覽器同一篇一天只記一次
  const count = markViewed(id, new Date().toLocaleDateString("sv"));
  try {
    // 整頁載入時登入狀態可能還在恢復：先等它，否則會員看不到自己按過的喜歡
    if (!session.ready) await session.restore();
    stats.value = await viewPost(id, count, session.me ? await session.accessToken() : null);
  } catch {
    // 讀不到就不顯示閱讀數；喜歡鈕照常可按
  }
}
const viewsText = computed(() => {
  const n = stats.value?.views;
  return n == null ? "" : t("blog.views", { n: new Intl.NumberFormat(locale.value, { notation: "compact", maximumFractionDigits: 1 }).format(n) });
});
async function toggleLike() {
  const p = post.value;
  if (!p) return;
  if (!session.me) { signInOpen.value = true; return; }
  // 樂觀更新：先變，失敗再還原
  const before = statsOf();
  const next = !before.liked;
  stats.value = { ...before, liked: next, likes: Math.max(0, before.likes + (next ? 1 : -1)) };
  const token = await session.accessToken();
  if (!token) { stats.value = before; signInOpen.value = true; return; }
  try {
    stats.value = { ...statsOf(), ...(await likePost(p.id, next, token)) };
    track("blog_like", { detail: next ? "on" : "off", subject: p.slug });
  } catch {
    stats.value = before;
    say(t("blog.likeFailed"));
  }
}

async function copyLink() {
  if (!post.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    say(t("blog.copied"));
    track("blog_share", { detail: "share_clipboard", subject: post.value.slug });
  } catch {
    // 拿不到剪貼簿（權限或舊瀏覽器）：網址列本身就是這篇的網址，不另外處理
  }
}
async function share() {
  if (!post.value) return;
  const subject = post.value.slug;
  try {
    await navigator.share({ title: post.value.title, url: shareUrl.value });
    track("blog_share", { detail: "share_web", subject });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") track("blog_share", { detail: "share_abort", subject });
  }
}

onMounted(() => {
  if (window.matchMedia?.("(max-width: 900px)").matches) tocOpen.value = false;
  fetchColumns().then((r) => { groups.value = r.items ?? []; }).catch(() => {});
});
watch([columnSlug, slug, preview], () => { void load(); }, { immediate: true });
onBeforeUnmount(() => { headingObserver?.disconnect(); endObserver?.disconnect(); clearTimeout(toastTimer); });
</script>

<template>
  <NotFoundPage v-if="missing" />
  <div v-else class="page blog-post" :aria-busy="loading && !!post">
    <p v-if="preview" class="notice blog-post__preview" role="status">{{ t("blog.preview") }}</p>

    <p v-if="failed" class="notice notice--error" role="alert">
      {{ t("blog.error") }}
      <button type="button" class="btn btn--sm" @click="load()">{{ t("blog.retry") }}</button>
    </p>

    <div v-else-if="!post" class="blog-post__skeleton" aria-hidden="true">
      <div class="ghost blog-post__skeleton-eyebrow" />
      <div class="ghost blog-post__skeleton-title" />
      <div v-for="i in 5" :key="i" class="ghost blog-post__skeleton-line" />
    </div>

    <template v-else>
      <header class="blog-post__head">
        <nav class="blog-post__crumbs" :aria-label="t('blog.breadcrumb')">
          <RouterLink :to="lp('/blog')">{{ t("blog.title") }}</RouterLink>
          <template v-if="postGroup">
            <span aria-hidden="true">›</span>
            <RouterLink :to="lp(`/blog/g/${postGroup.slug}`)">{{ columnName(postGroup, locale) }}</RouterLink>
          </template>
          <span aria-hidden="true">›</span>
          <RouterLink :to="lp(`/blog/${post.columnSlug}`)" class="blog-post__column">{{ column }}</RouterLink>
        </nav>
        <h1 class="blog-post__title">{{ post.title }}</h1>
        <p class="blog-post__meta">
          <span class="blog-post__official">{{ t("blog.official") }}</span>
          <time v-if="published" :datetime="new Date(published).toISOString()">{{ dateOnly(published / 1000) }}</time>
          <span v-if="updated">{{ t("blog.updated", { date: updated }) }}</span>
          <span>{{ t("blog.readMinutes", { n: post.readMinutes }) }}</span>
          <span v-if="viewsText">{{ viewsText }}</span>
        </p>
        <img v-if="post.coverUrl" :src="post.coverUrl" alt="" class="blog-post__cover" />
      </header>
      <BlogCampaign v-if="post.campaign" :campaign="post.campaign" :subject="post.slug" at="top" />

      <div class="blog-post__layout" :class="{ 'blog-post__layout--toc': longRead }">
        <aside v-if="longRead" class="toc">
          <details class="toc__fold" :open="tocOpen">
            <summary class="toc__title eyebrow">{{ t("blog.toc") }}</summary>
            <nav :aria-label="t('blog.toc')">
              <ul class="toc__list">
                <li v-for="item in rendered.toc" :key="item.id" :class="[`toc__item--h${item.level}`, { 'toc__item--on': activeId === item.id }]">
                  <a :href="`#${item.id}`" class="toc__link">{{ item.text }}</a>
                </li>
              </ul>
            </nav>
          </details>
        </aside>

        <div class="blog-post__main">
          <article ref="article" class="blog-post__body" v-html="rendered.html" />
          <BlogCampaign v-if="post.campaign" :campaign="post.campaign" :subject="post.slug" at="end" />

          <div ref="endEl" class="blog-post__share">
            <button
              v-if="!preview" type="button" class="btn btn--sm blog-like" :class="{ 'blog-like--on': stats?.liked }" data-action="like"
              :aria-pressed="stats?.liked ? 'true' : 'false'" :aria-label="t('blog.likeLabel', { n: stats?.likes ?? 0 })" @click="toggleLike"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.5c0 3.8-5.5 7.2-5.5 7.2z" /></svg>
              <span>{{ stats?.likes ? stats.likes : t("blog.like") }}</span>
            </button>
            <button type="button" class="btn btn--sm" @click="copyLink">{{ t("blog.copyLink") }}</button>
            <button v-if="canShare" type="button" class="btn btn--sm" @click="share">{{ t("blog.share") }}</button>
          </div>

          <nav v-if="data!.adjacent.prev || data!.adjacent.next" class="blog-post__adjacent">
            <RouterLink v-if="data!.adjacent.prev" :to="lp(postPath(data!.adjacent.prev))" class="blog-post__step">
              <span class="subtle">{{ t("blog.prev") }}</span><span class="blog-post__step-title">{{ data!.adjacent.prev.title }}</span>
            </RouterLink>
            <RouterLink v-if="data!.adjacent.next" :to="lp(postPath(data!.adjacent.next))" class="blog-post__step blog-post__step--next">
              <span class="subtle">{{ t("blog.next") }}</span><span class="blog-post__step-title">{{ data!.adjacent.next.title }}</span>
            </RouterLink>
          </nav>

          <section v-if="data!.related.length" class="blog-post__section" aria-labelledby="related-h">
            <h2 id="related-h" class="blog-post__h2">{{ t("blog.related") }}</h2>
            <div class="blog-post__related">
              <BlogPostCard v-for="p in data!.related" :key="p.id" :post="p" :column="columnOf(p.columnSlug)" />
            </div>
          </section>

          <section v-if="!preview" id="comments" class="blog-post__section" aria-labelledby="comments-h">
            <h2 id="comments-h" class="blog-post__h2">{{ t("blog.comments") }}</h2>
            <CommentPanel :key="post.id" :target="{ kind: 'post', postId: post.id, commentsClosed: post.commentsClosed }" />
          </section>
        </div>
      </div>
    </template>

    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
    <GuestSignInSheet v-if="signInOpen" :return-to="route.fullPath" @close="signInOpen = false" />
  </div>
</template>

<style scoped>
.blog-post { max-width: 1100px; display: grid; gap: var(--s-6); }
.blog-post__preview { margin: 0; background: var(--gold-soft); color: var(--text); }
.blog-post__head { display: grid; gap: var(--s-3); max-width: 80ch; }
.blog-post__crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--text-3); }
.blog-post__crumbs a { color: var(--text-3); }
.blog-post__crumbs a:hover { color: var(--text); }
.blog-post__crumbs .blog-post__column { font-weight: 600; color: var(--accent-text); }
.blog-post__title { margin: 0; font-size: clamp(26px, 3.4vw, 36px); line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.blog-post__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s-2); margin: 0; font-size: 13px; color: var(--text-3); }
.blog-post__meta > * + *::before { content: "·"; margin-right: var(--s-2); }
.blog-post__official { padding: 1px 8px; border-radius: var(--r-pill); background: var(--accent-tint); color: var(--accent-text); font-size: 12px; font-weight: 600; }
.blog-post__meta > .blog-post__official + *::before { content: none; }
.blog-post__cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--r-lg); margin-top: var(--s-2); background: var(--surface-2); }

.blog-post__layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-6); align-items: start; }
.blog-post__layout--toc { grid-template-columns: 220px minmax(0, 1fr); gap: var(--s-7); }
.blog-post__main { display: grid; gap: var(--s-6); min-width: 0; max-width: 80ch; }

.toc { position: sticky; top: calc(var(--header-h) + var(--s-4)); max-height: calc(100vh - var(--header-h) - var(--s-6)); overflow-y: auto; }
.toc__fold > summary { list-style: none; cursor: default; }
.toc__fold > summary::-webkit-details-marker { display: none; }
.toc__title { margin: 0 0 var(--s-2); padding-left: 12px; }
.toc__list { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--line); }
.toc__link { display: block; padding: 4px 12px; margin-left: -1px; border-left: 2px solid transparent; font-size: 13px; line-height: 1.4; color: var(--text-2); overflow-wrap: anywhere; transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
.toc__item--h3 .toc__link { padding-left: 24px; font-size: 12px; color: var(--text-3); }
.toc__link:hover { color: var(--text); }
.toc__item--on > .toc__link { color: var(--accent-text); border-left-color: var(--accent); font-weight: 600; }

/* 內文：跟文件頁同一套排版 */
.blog-post__body { font-size: 16px; line-height: 1.85; overflow-wrap: anywhere; }
.blog-post__body :deep(h2) { font-size: 22px; line-height: 1.35; margin: var(--s-7) 0 var(--s-3); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.blog-post__body :deep(h3) { font-size: 18px; margin: var(--s-5) 0 var(--s-2); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.blog-post__body :deep(:first-child) { margin-top: 0; }
.blog-post__body :deep(p) { margin: 0 0 var(--s-4); }
.blog-post__body :deep(ul), .blog-post__body :deep(ol) { margin: 0 0 var(--s-4); padding-left: 1.4em; }
.blog-post__body :deep(li) { margin: 2px 0; }
.blog-post__body :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.blog-post__body :deep(strong) { font-weight: 600; }
.blog-post__body :deep(img) { display: block; max-width: 100%; height: auto; margin: var(--s-4) 0; border-radius: var(--r-md); }
.blog-post__body :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); }
.blog-post__body :deep(pre) { margin: 0 0 var(--s-4); padding: var(--s-3) var(--s-4); overflow-x: auto; border-radius: var(--r-md); background: var(--surface-2); font-size: 13px; line-height: 1.6; }
.blog-post__body :deep(pre code) { padding: 0; background: none; }
.blog-post__body :deep(blockquote) { margin: 0 0 var(--s-4); padding: var(--s-2) var(--s-4); border-left: 3px solid var(--accent); background: var(--accent-tint); border-radius: 0 var(--r-sm) var(--r-sm) 0; color: var(--text-2); }
.blog-post__body :deep(blockquote p:last-child) { margin-bottom: 0; }
.blog-post__body :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; margin: 0 0 var(--s-4); font-size: 14px; }
.blog-post__body :deep(th), .blog-post__body :deep(td) { padding: 8px 12px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
.blog-post__body :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: var(--s-6) 0; }

.blog-post__share { display: flex; flex-wrap: wrap; gap: var(--s-2); padding-top: var(--s-4); box-shadow: 0 -1px 0 var(--line); }
.blog-like { display: inline-flex; align-items: center; gap: var(--s-1); font-variant-numeric: tabular-nums; }
.blog-like svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; }
.blog-like--on { color: var(--accent-text); }
.blog-like--on svg { fill: currentColor; }
.blog-post__adjacent { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-3); }
.blog-post__step { display: grid; gap: 2px; padding: var(--s-3) var(--s-4); border: 1px solid var(--line); border-radius: var(--r-md); color: inherit; min-width: 0; }
.blog-post__step:hover { border-color: var(--line-strong); }
.blog-post__step--next { grid-column: 2; text-align: end; }
.blog-post__step-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.blog-post__section { display: grid; gap: var(--s-4); }
.blog-post__h2 { margin: 0; font-size: 18px; }
.blog-post__related { display: grid; gap: var(--s-5); grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }

.blog-post__skeleton { display: grid; gap: var(--s-3); max-width: 80ch; }
.blog-post__skeleton-eyebrow { width: 80px; height: 16px; border-radius: var(--r-sm); }
.blog-post__skeleton-title { width: 70%; height: 40px; margin-bottom: var(--s-4); }
.blog-post__skeleton-line { height: 18px; border-radius: var(--r-sm); }

@media (max-width: 900px) {
  .blog-post__layout--toc { grid-template-columns: minmax(0, 1fr); gap: var(--s-4); }
  .toc { position: static; max-height: none; }
  .toc__fold { padding: var(--s-3) var(--s-4); background: var(--surface); border-radius: var(--r-lg); box-shadow: 0 0 0 1px var(--line); }
  .toc__fold > summary { cursor: pointer; padding-left: 0; }
  .toc__title { margin: 0; }
  .toc__fold[open] .toc__title { margin-bottom: var(--s-2); }
}
@media (max-width: 600px) {
  .blog-post__adjacent { grid-template-columns: minmax(0, 1fr); }
  .blog-post__step--next { grid-column: auto; }
}
</style>
