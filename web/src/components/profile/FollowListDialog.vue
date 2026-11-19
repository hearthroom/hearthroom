<script setup lang="ts">
/**
 * 關注／粉絲名單彈層（任務 2026-11-19-profile-visibility ui.md §3.4）。桌機置中 modal，手機（≤480）從底部升起。
 *
 * 名單只列「雙方都公開」的關注；人數是完整人數，沒列出的差額放在標題列下那一條說明，一打開就看得到，
 * 不然看到標題寫 3,420、下面只有十幾列，會以為壞了。人數不是 0、卻一列都沒有（上線初期最常見），
 * 是「都沒有公開」，不是空態。開著的時候作者改成不公開，伺服器回 403，這裡說明並通知外層重讀數字。
 *
 * 打開時推一筆歷史，手機返回鍵先關彈層、不離開頁面；用別的方式關掉時把那一筆退回去。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AccountIcon from '@/components/AccountIcon.vue';
import { ApiError, fetchFollowList, fetchOwnFollowers } from '@/lib/api';
import { wrapTab } from '@/lib/focus-trap';
import { hueFrom } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import type { FollowListPage } from '@/lib/types';

const props = defineProps<{
  kind: 'following' | 'followers';
  /** 看別人的名單：作者的公開 ID；不給＝本人看自己的粉絲 */
  handle?: string;
  /** 開啟前就知道的人數（數據列上那個），先放在標題旁 */
  total: number;
  /** 關掉後焦點還給它 */
  opener?: HTMLElement | null;
}>();
const emit = defineEmits<{ close: []; notPublic: [] }>();
const { t, locale } = useI18n();
const fmt = (n: number) => new Intl.NumberFormat(locale.value).format(n);
const { lp } = useLocalePath();
const session = useSession();

const dialog = ref<HTMLElement | null>(null);
const titleEl = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const page = ref<FollowListPage | null>(null);
const items = ref<FollowListPage['items']>([]);
const loading = ref(false), showSkeleton = ref(false), failed = ref(false), moreFailed = ref(false), notPublic = ref(false);
const titleId = 'follow-list-' + Math.random().toString(36).slice(2);
let generation = 0;

const total = computed(() => page.value?.total ?? props.total);
const unlisted = computed(() => page.value?.unlisted ?? 0);
const state = computed(() => {
  if (notPublic.value) return 'notPublic';
  if (failed.value) return 'error';
  if (!page.value) return showSkeleton.value ? 'loading' : 'pending';
  if (page.value.total === 0) return 'empty';
  if (!items.value.length) return 'allUnlisted';
  return 'list';
});

async function load(more = false) {
  const current = more ? generation : ++generation;
  loading.value = true; moreFailed.value = false;
  if (!more) failed.value = false;
  // 預期 200ms 內回來的不顯示骨架
  const timer = setTimeout(() => { if (current === generation && !page.value) showSkeleton.value = true; }, 200);
  const offset = more ? items.value.length : 0;
  const before = items.value.length;
  try {
    let result: FollowListPage;
    if (props.handle) result = await fetchFollowList(props.handle, props.kind, offset);
    else {
      const token = await session.accessToken();
      if (!token) throw new Error(t('auth.expired'));
      result = await fetchOwnFollowers(token, offset);
    }
    if (current !== generation) return;
    page.value = result;
    items.value = more ? [...items.value, ...result.items] : result.items;
    if (more) {
      // 焦點移到新增的第一列，不要留在消失的按鈕上
      await nextTick();
      list.value?.querySelectorAll<HTMLElement>('.fl__row')[before]?.focus();
    }
  } catch (err) {
    if (current !== generation) return;
    if (err instanceof ApiError && err.status === 403) { notPublic.value = true; emit('notPublic'); }
    else if (more) moreFailed.value = true;
    else failed.value = true;
  } finally {
    clearTimeout(timer);
    if (current === generation) { loading.value = false; showSkeleton.value = false; }
  }
}

let closed = false, pushed = false, openedAt = '', overflow = '', background: HTMLElement | null = null, previousInert = false;
// 彈層推的那一筆被退掉時，路由也會收到同一個網址的 popstate（它的監聽先註冊，攔不下來）。
// 實測（2026-11-19，本機真 Worker）：同頁換頁不會捲動、頁面瀏覽事件對同一路徑去重，焦點也照樣還給數據格，所以不另外處理。
function onPop() {
  pushed = false;
  close();
}
function close() {
  if (closed) return;
  closed = true;
  if (pushed) { pushed = false; history.back(); }
  emit('close');
}
/** 點名單裡的人：用那個人的頁面取代彈層推的那一筆，返回鍵直接回到原本的頁面 */
function follow() {
  closed = true; pushed = false;
  emit('close');
}
function keydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else wrapTab(e, dialog.value, 'button:not(:disabled),a[href]');
}
onMounted(async () => {
  // 帶著路由自己的 state 推一筆，返回時路由看到的是同一個位置，不會換頁
  openedAt = location.href;
  history.pushState({ ...(history.state ?? {}) }, '', location.href);
  pushed = true;
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', keydown);
  overflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
  background = document.getElementById('app'); if (background) { previousInert = background.inert; background.inert = true; }
  await nextTick();
  titleEl.value?.focus();
  void load();
});
onBeforeUnmount(() => {
  generation++;
  // 外層拿掉彈層但還在同一頁時，把推的那一筆退回去；已經換頁就不動歷史
  window.removeEventListener('popstate', onPop);
  if (pushed && location.href === openedAt) history.back();
  pushed = false;
  document.removeEventListener('keydown', keydown);
  document.documentElement.style.overflow = overflow;
  if (background) background.inert = previousInert;
  props.opener?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="close">
      <div ref="dialog" class="modal panel fl" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <span class="fl__grab" aria-hidden="true" />
        <header class="fl__head">
          <h2 :id="titleId" ref="titleEl" class="fl__title" tabindex="-1">{{ $t('profile.stat.' + kind) }}<span class="fl__count">{{ fmt(total) }}</span></h2>
          <button type="button" class="btn btn--ghost btn--icon btn--sm fl__close" :aria-label="$t('dialog.close')" @click="close">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <p v-if="state === 'list' && unlisted > 0" class="fl__unlisted"><AccountIcon name="eyeOff" />{{ $t('profile.list.partialHidden', { n: fmt(unlisted) }, unlisted) }}</p>

        <div class="fl__body" :aria-busy="loading">
          <ul v-if="state === 'loading'" class="fl__list" aria-hidden="true">
            <li v-for="n in 6" :key="n" class="fl__ghost"><span class="ghost fl__ghost-face" /><span class="fl__ghost-lines"><span class="ghost" /><span class="ghost" /></span></li>
          </ul>

          <template v-else-if="state === 'list'">
            <ul ref="list" class="fl__list">
              <li v-for="p in items" :key="p.handle">
                <RouterLink :to="lp(`/authors/${p.handle}`)" replace class="fl__row" @click="follow">
                  <img v-if="p.avatar" :src="p.avatar" alt="" class="fl__face" loading="lazy" />
                  <span v-else class="fl__face mono" :style="{ '--h': hueFrom(p.name) }" aria-hidden="true">{{ [...p.name][0] }}</span>
                  <span class="fl__who"><strong>{{ p.name }}</strong><span>@{{ p.handle }}</span></span>
                  <svg class="fl__arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </RouterLink>
              </li>
            </ul>
            <div v-if="moreFailed" class="fl__more-error" role="alert">
              <span>{{ $t('profile.list.error.title') }}</span>
              <button type="button" class="btn btn--sm" @click="load(true)">{{ $t('library.retry') }}</button>
            </div>
            <div v-else-if="page?.hasNext" class="fl__more">
              <button type="button" class="btn btn--sm fl__more-btn" :disabled="loading" @click="load(true)">
                <span v-if="loading" class="fl__spin" aria-hidden="true" /><span :class="{ 'fl__more-text--busy': loading }">{{ $t('checkin.history.more') }}</span>
              </button>
            </div>
          </template>

          <div v-else-if="state !== 'pending'" class="fl__state" :role="state === 'error' ? 'alert' : undefined">
            <AccountIcon :name="state === 'empty' ? (kind === 'followers' ? 'heart' : 'users') : state === 'error' ? 'refresh' : 'eyeOff'" class="fl__state-icon" :class="{ 'fl__state-icon--strong': state === 'allUnlisted' || state === 'notPublic' }" />
            <template v-if="state === 'empty'"><strong>{{ $t(kind === 'followers' ? 'profile.list.emptyFollowers.title' : 'profile.list.emptyFollowing.title') }}</strong><p>{{ $t(kind === 'followers' ? 'profile.list.emptyFollowers.hint' : 'profile.list.emptyFollowing.hint') }}</p></template>
            <template v-else-if="state === 'allUnlisted'"><strong>{{ $t('profile.list.allHidden.title', { n: fmt(total) }, total) }}</strong><p>{{ $t('profile.list.allHidden.hint') }}</p></template>
            <template v-else-if="state === 'notPublic'"><strong>{{ $t('profile.list.closed') }}</strong></template>
            <template v-else><strong>{{ $t('profile.list.error.title') }}</strong><p>{{ $t('profile.list.error.hint') }}</p><button type="button" class="btn btn--sm" @click="load()">{{ $t('library.retry') }}</button></template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fl { position: relative; display: flex; flex-direction: column; gap: 0; max-height: min(600px, calc(100dvh - 2 * var(--s-5))); padding: 0; overflow: hidden; }
.fl__grab { display: none; }
.fl__head { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-4) var(--s-3) var(--s-3) var(--s-5); box-shadow: inset 0 -1px 0 var(--line); }
.fl__title { display: flex; align-items: baseline; gap: var(--s-2); flex: 1; min-width: 0; margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; outline: none; }
.fl__count { font-size: 13px; font-weight: 500; color: var(--text-3); font-variant-numeric: tabular-nums; }
.fl__close svg { width: 16px; height: 16px; }
.fl__unlisted { display: flex; align-items: center; gap: var(--s-2); margin: 0; padding: var(--s-2) var(--s-5); background: var(--surface-2); box-shadow: inset 0 -1px 0 var(--line); font-size: 13px; line-height: 1.6; color: var(--text-2); }
.fl__unlisted svg { width: 16px; height: 16px; flex: none; }
.fl__body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.fl__list { list-style: none; margin: 0; padding: var(--s-2) 0; }
.fl__row { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: var(--s-3); min-height: 56px; padding: var(--s-2) var(--s-5); color: inherit; transition: background var(--dur) var(--ease); }
.fl__row:hover { background: var(--surface-2); }
.fl__face { width: 40px; height: 40px; border-radius: var(--r-pill); object-fit: cover; font-size: 16px; }
.fl__who { display: grid; min-width: 0; line-height: 1.4; }
.fl__who strong { font-size: 14.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl__who span { font-size: 13px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl__arrow { width: 12px; height: 12px; color: var(--text-3); }
.fl__ghost { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: var(--s-3); min-height: 56px; padding: var(--s-2) var(--s-5); }
.fl__ghost-face { width: 40px; height: 40px; border-radius: var(--r-pill); }
.fl__ghost-lines { display: grid; gap: 6px; }
.fl__ghost-lines .ghost { height: 12px; border-radius: var(--r-sm); width: 60%; }
.fl__ghost-lines .ghost + .ghost { width: 35%; }
.fl__more { display: flex; justify-content: center; padding: var(--s-2) var(--s-5) var(--s-4); }
.fl__more-btn { position: relative; }
.fl__more-text--busy { visibility: hidden; }
.fl__spin { position: absolute; inset: 0; margin: auto; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: var(--r-pill); animation: fl-spin 0.8s linear infinite; }
@keyframes fl-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .fl__spin { animation-duration: 2.4s; } }
.fl__more-error { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin: 0 var(--s-5) var(--s-4); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; color: var(--text-2); }
.fl__state { display: grid; justify-items: center; gap: var(--s-2); padding: var(--s-7) var(--s-5); text-align: center; }
.fl__state strong { font-size: 15px; font-weight: 600; }
.fl__state p { margin: 0; max-width: 22rem; font-size: 13px; line-height: 1.6; color: var(--text-2); }
.fl__state .btn { margin-top: var(--s-2); }
.fl__state-icon { width: 28px; height: 28px; color: var(--text-3); }
.fl__state-icon--strong { color: var(--text-2); }
:lang(ko) .fl__state, :lang(ko) .fl__unlisted { word-break: keep-all; }
:lang(ja) .fl__state, :lang(ja) .fl__unlisted { word-break: auto-phrase; }
@media (max-width: 480px) {
  .fl { width: 100%; max-height: 82dvh; border-radius: 24px; padding-bottom: env(safe-area-inset-bottom); }
  .fl__grab { display: block; position: absolute; top: 8px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: var(--r-pill); background: var(--border-strong); }
  .fl__head { padding-top: var(--s-5); }
}
</style>
