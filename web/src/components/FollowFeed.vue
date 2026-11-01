<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { libraryRequest } from '@/lib/library';
import { contentLang } from '@/lib/i18n';
import type { CardPage, CommunityCard } from '@/lib/types';
import CardGrid from './CardGrid.vue';

/**
 * 首頁「關注」分頁：關注作者的新卡與作者選擇通知的更新，依事件時間新到舊（排序與去重在伺服器）。
 * 續載跟首頁卡片模式同一種：捲到底自動接下一批，沒有上一頁／下一頁。
 */
const emit = defineEmits<{ discover: []; top: [] }>();
const session = useSession();
const { locale, lp } = useLocalePath();

const items = ref<CommunityCard[]>([]);
const loading = ref(false), failed = ref(false), done = ref(false);
/** 骨架等 200ms 再出：多數時候回應比這快，閃一下骨架反而像跳版 */
const slow = ref(false);
let offset = 0, cursor: string | undefined, sequence = 0, slowTimer: ReturnType<typeof setTimeout> | undefined;

/** 有沒有關注人看個人資料的數字；它可能晚一拍，所以有動態就照列，不看這個數 */
const followsAnyone = computed(() => (session.profile?.following ?? 0) > 0);
const empty = computed(() => done.value && !items.value.length);

async function next() {
  if (!session.me || loading.value || done.value) return;
  const seq = sequence;
  loading.value = true; failed.value = false;
  clearTimeout(slowTimer); slowTimer = setTimeout(() => { slow.value = true; }, 200);
  try {
    const token = await session.accessToken();
    if (!token) throw new Error('auth');
    const page = await libraryRequest<CardPage>(`feed?offset=${offset}&lang=${contentLang(locale.value)}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, token);
    if (seq !== sequence) return;
    // 依偏移翻頁，捲動途中關注的作者發了新卡或更新，整列往後推一格，下一批會再帶到上一批最後那張：已經列過的不再列
    const seen = new Set(items.value.map((card) => card.id));
    items.value = [...items.value, ...page.items.filter((card) => !seen.has(card.id))];
    offset += page.limit || 24;
    cursor = page.nextCursor;
    done.value = !page.hasNext;
  } catch { if (seq === sequence) failed.value = true; }
  finally {
    if (seq === sequence) { loading.value = false; slow.value = false; clearTimeout(slowTimer); scheduleCheck(); }
  }
}
function reset() {
  ++sequence;
  items.value = []; offset = 0; cursor = undefined;
  loading.value = false; failed.value = false; done.value = false; slow.value = false; clearTimeout(slowTimer);
  void next();
}
watch([() => session.me?.accountNumId, () => session.profile?.showNsfw, () => session.profile?.hiddenTags?.join(','), locale], reset, { immediate: true });

// 跟首頁卡片模式一樣，IntersectionObserver 與捲動都檢查尾端：接上來的一批可能讓哨兵一直在畫面內，不會再觸發一次 observer
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | undefined, frame = 0;
function checkTail() {
  frame = 0;
  if (loading.value || done.value || failed.value || !items.value.length || !sentinel.value) return;
  if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 400) void next();
}
function scheduleCheck() { if (!frame) frame = requestAnimationFrame(checkTail); }
onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(scheduleCheck, { rootMargin: '400px' });
    if (sentinel.value) observer.observe(sentinel.value);
  }
  window.addEventListener('scroll', scheduleCheck, { passive: true });
  window.addEventListener('resize', scheduleCheck);
});
onBeforeUnmount(() => {
  ++sequence;
  observer?.disconnect(); cancelAnimationFrame(frame); clearTimeout(slowTimer);
  window.removeEventListener('scroll', scheduleCheck);
  window.removeEventListener('resize', scheduleCheck);
});
</script>
<template>
  <section class="feed" :aria-label="$t('library.feed')">
    <div v-if="!session.me" class="empty panel">
      <p class="empty__title">{{ $t('library.feedGuest') }}</p>
      <RouterLink class="btn btn--primary btn--lg" :to="lp('/login?returnTo=' + encodeURIComponent(lp('/?mode=following')))">{{ $t('nav.login') }}</RouterLink>
    </div>
    <template v-else>
      <div v-if="items.length || followsAnyone" class="feed__intro"><RouterLink :to="lp('/library?tab=following')">{{ $t('library.manageFollowing') }} →</RouterLink></div>
      <div v-if="failed && !items.length" class="notice notice--error feed__error" role="alert">
        <p>{{ $t('home.firstError') }}</p><button class="btn" @click="next">{{ $t('home.retry') }}</button>
      </div>
      <template v-else-if="!items.length && loading">
        <p class="sr-only" role="status">{{ $t('home.loading') }}</p>
        <div v-if="slow" class="grid feed__ghosts" aria-hidden="true"><div v-for="i in 8" :key="i" class="ghost" /></div>
      </template>
      <div v-else-if="empty" class="empty panel">
        <p class="empty__title">{{ $t(followsAnyone ? 'library.feedQuietTitle' : 'library.followingEmpty') }}</p>
        <p class="empty__hint muted">{{ $t(followsAnyone ? 'library.feedQuietHint' : 'library.feedEmptyHint') }}</p>
        <button class="btn btn--primary btn--lg" type="button" @click="emit('discover')">{{ $t('library.browseToday') }}</button>
      </div>
      <CardGrid v-else-if="items.length" :cards="items" />
    </template>
    <div ref="sentinel" class="stream-tail">
      <template v-if="items.length">
        <div v-if="failed" class="notice notice--error feed__error" role="alert">
          <p>{{ $t('home.appendError') }}</p><button class="btn" @click="next">{{ $t('home.retry') }}</button>
        </div>
        <template v-else-if="loading">
          <p class="sr-only" role="status">{{ $t('home.loading') }}</p>
          <div class="grid feed__ghosts" aria-hidden="true"><div v-for="i in 8" :key="i" class="ghost" /></div>
        </template>
        <div v-else-if="done" class="stream-end" role="status">
          <p>{{ $t('home.end') }}</p>
          <button class="btn btn--ghost" type="button" @click="emit('top')">{{ $t('home.top') }}</button>
        </div>
      </template>
    </div>
  </section>
</template>
<style scoped>
.feed { display: grid; gap: var(--s-4); }
.feed__intro { display: flex; justify-content: flex-end; }
.feed__intro a { min-height: var(--h-sm); display: inline-flex; align-items: center; font-size: 13.5px; font-weight: 500; }
.feed__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); }
.feed__error p { margin: 0; }
/* 觸控裝置上「重試」用 44 高，手指按得到 */
@media (pointer: coarse) { .feed__error .btn { height: var(--h-lg); } }
/* 欄數由首頁的 .board-page :deep(.grid) 給，跟卡片格對齊 */
.feed__ghosts { display: grid; gap: var(--s-5) var(--s-4); }
.feed__ghosts .ghost { aspect-ratio: 3 / 5.3; }
/* 手機兩欄四格就夠了，多的只會把結尾推出畫面 */
@media (max-width: 599px) { .feed__ghosts .ghost:nth-child(n + 5) { display: none; } }
.empty { padding: var(--s-6) var(--s-5); text-align: center; display: grid; justify-items: center; gap: var(--s-2); }
.empty__title { margin: 0; font-size: 16px; font-weight: 600; }
.empty__hint { margin: 0; font-size: 13.5px; max-width: 34ch; }
.empty .btn { margin-top: var(--s-3); }
.stream-tail { min-height: 1px; }
.stream-end { text-align: center; padding: var(--s-6); color: var(--text-2); }
</style>
