<script setup lang="ts">
/**
 * 部落格列表的一張文章卡：封面、欄目與日期、標題、摘要、閱讀時長。hero 是列表首屏那張大圖。
 * badge 插槽給之後的活動狀態標籤用，疊在封面左上角。
 */
import { RouterLink } from "vue-router";
import { dateOnly, hueFrom } from "@/lib/format";
import { postPath, type PostCard } from "@/lib/blog";
import { useLocalePath } from "@/lib/use-locale";

defineProps<{ post: PostCard; column: string; hero?: boolean }>();
const { lp } = useLocalePath();
</script>

<template>
  <article class="post-card" :class="{ 'post-card--hero': hero }">
    <RouterLink :to="lp(postPath(post))" class="post-card__link">
      <div class="post-card__cover" :style="{ '--h': hueFrom(post.title) }">
        <img v-if="post.coverUrl" :src="post.coverUrl" alt="" :loading="hero ? 'eager' : 'lazy'" />
        <div v-if="$slots.badge" class="post-card__badge"><slot name="badge" /></div>
      </div>
      <div class="post-card__text">
        <p class="post-card__meta">
          <span v-if="column">{{ column }}</span>
          <span v-if="post.firstPublishedAt">{{ dateOnly(post.firstPublishedAt / 1000) }}</span>
          <span>{{ $t("blog.readMinutes", { n: post.readMinutes }) }}</span>
        </p>
        <h2 class="post-card__title">{{ post.title }}</h2>
        <p v-if="post.excerpt" class="post-card__excerpt">{{ post.excerpt }}</p>
      </div>
    </RouterLink>
  </article>
</template>

<style scoped>
.post-card { min-width: 0; }
.post-card__link { display: grid; gap: var(--s-3); height: 100%; color: inherit; }
.post-card__cover {
  position: relative; overflow: hidden; aspect-ratio: 16 / 9; border-radius: var(--r-md);
  /* 沒有封面：由標題派生一個淡淡的色相，比真封面輕，彼此又分得開 */
  background: hsl(var(--h, 220) 30% 92%);
}
:root[data-mode="dark"] .post-card__cover { background: hsl(var(--h, 220) 22% 16%); }
.post-card__cover img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform var(--dur-slow) var(--ease); }
.post-card__link:hover .post-card__cover img { transform: scale(1.02); }
.post-card__badge { position: absolute; top: var(--s-3); left: var(--s-3); display: flex; gap: var(--s-2); }
.post-card__text { display: grid; gap: var(--s-1); min-width: 0; }
.post-card__meta { display: flex; flex-wrap: wrap; gap: 0 var(--s-2); margin: 0; font-size: 12.5px; color: var(--text-3); }
.post-card__meta span + span::before { content: "·"; margin-right: var(--s-2); }
.post-card__title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.post-card__link:hover .post-card__title { color: var(--accent-text); }
.post-card__excerpt { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.post-card--hero .post-card__title { font-size: clamp(20px, 2.6vw, 28px); line-height: 1.3; letter-spacing: -0.01em; }
.post-card--hero .post-card__excerpt { font-size: 15px; -webkit-line-clamp: 3; }
@media (min-width: 820px) {
  .post-card--hero .post-card__link { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--s-6); align-items: center; }
}
</style>
