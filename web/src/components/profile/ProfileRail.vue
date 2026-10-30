<script setup lang="ts">
/**
 * 主頁右欄：上面一行「完善主頁」（做完就收起），下面是原本「我的」頁那串入口，一個都不少：
 * 通知、邀請獎勵、活動中心、Discord 社區、社區管理、查看公開頁、用戶設定、退出（owner 2026-10-19）。
 * 積分在資料頭的積分卡上，我的資源在資料頭下面那排，不在這裡重複。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AccountIcon from '@/components/AccountIcon.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';
import ReviewBadge from '@/components/ReviewBadge.vue';
import { can } from '@/lib/provider';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { useNotifications } from '@/lib/notifications';
import { useReviewer } from '@/lib/review';
import { logoutWithRoutes } from '@/lib/logout';
import type { CommunityView } from '@/lib/community';
import type { Author } from '@/lib/types';

const props = defineProps<{ community: CommunityView | null; author: Author | null }>();
const emit = defineEmits<{ edit: [] }>();
const session = useSession();
const notifications = useNotifications();
const reviewer = useReviewer();
const { t } = useI18n();
const { lp } = useLocalePath();

const handle = computed(() => session.profile?.handle ?? '');
const linked = computed(() => !!props.community?.link && props.community.link.state !== 'cleanup');
const discordState = computed(() => {
  const c = props.community;
  if (!c) return '';
  if (!c.enabled) return t('community.unavailable');
  const state = c.link?.state ?? 'unlinked';
  return state === 'synced' ? t('profile.linked') : t('community.states.' + state);
});

/** 完善主頁：五步，順序就是建議做的順序 */
const steps = computed(() => [
  { key: 'avatar', done: !!session.avatarUrl, to: null },
  { key: 'bio', done: !!session.profile?.bio, to: null },
  { key: 'discord', done: linked.value, to: lp('/me/community') },
  { key: 'card', done: (props.author?.cardCount ?? 0) > 0, to: lp('/mine') },
  { key: 'tips', done: (session.profile?.tipLinks?.length ?? 0) > 0, to: null },
]);
const doneCount = computed(() => steps.value.filter((s) => s.done).length);
const next = computed(() => steps.value.find((s) => !s.done) ?? null);
</script>

<template>
  <aside class="rail" :aria-label="$t('profile.quick')">
    <component :is="next.to ? RouterLink : 'button'" v-if="next && session.profile" :to="next.to ?? undefined" :type="next.to ? undefined : 'button'" class="todo panel" @click="!next.to && emit('edit')">
      <span class="todo__ring" :style="{ '--p': (doneCount / steps.length) * 100 + '%' }"><span>{{ doneCount }}/{{ steps.length }}</span></span>
      <span class="todo__text"><strong>{{ $t('profile.todo.title') }}</strong><span>{{ $t('profile.todo.next', { step: $t('profile.todo.' + next.key) }) }}</span></span>
      <AccountIcon name="arrow" class="todo__arrow" />
    </component>

    <nav class="quick panel" :aria-label="$t('profile.quick')">
      <RouterLink :to="lp('/me/notifications')" class="quick__row"><span class="quick__icon quick__icon--accent"><AccountIcon name="bell" /></span><span class="quick__label">{{ $t('nav.notifications') }}</span><span v-if="notifications.unread" class="quick__count">{{ notifications.unread > 99 ? '99+' : notifications.unread }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink :to="lp('/me/referral')" class="quick__row"><span class="quick__icon quick__icon--gold"><AccountIcon name="gift" /></span><span class="quick__label">{{ $t('referral.title') }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink :to="lp('/campaigns')" class="quick__row"><span class="quick__icon quick__icon--gold"><AccountIcon name="spark" /></span><span class="quick__label">{{ $t('campaign.hub.title') }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink :to="lp('/me/community')" class="quick__row"><span class="quick__icon quick__icon--discord"><CommunityIcon name="discord" /></span><span class="quick__label">{{ $t('community.title') }}</span><span class="quick__meta" :class="{ 'quick__meta--ok': linked }">{{ discordState }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink v-if="reviewer.reviewer || reviewer.blogWriter" :to="lp(reviewer.reviewer ? '/review' : '/review/blog')" class="quick__row"><span class="quick__icon"><AccountIcon name="shield" /></span><span class="quick__label">{{ $t('nav.review') }}</span><ReviewBadge /><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink v-if="handle" :to="lp(`/authors/${handle}`)" class="quick__row"><span class="quick__icon"><AccountIcon name="eye" /></span><span class="quick__label">{{ $t('me.publicPage') }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink v-if="can('presets')" :to="lp('/me/presets')" class="quick__row"><span class="quick__icon"><AccountIcon name="news" /></span><span class="quick__label">{{ $t('preset.nav') }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink v-if="can('instructions')" :to="lp('/me/instructions')" class="quick__row"><span class="quick__icon"><AccountIcon name="chat" /></span><span class="quick__label">{{ $t('instructions.nav') }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <RouterLink :to="lp('/settings')" class="quick__row"><span class="quick__icon"><AccountIcon name="settings" /></span><span class="quick__label">{{ $t('nav.settings') }}</span><AccountIcon name="arrow" class="quick__chevron" /></RouterLink>
      <hr class="quick__rule" />
      <button type="button" class="quick__row quick__logout" @click="logoutWithRoutes(session)"><span class="quick__icon quick__icon--plain"><AccountIcon name="logout" /></span><span class="quick__label">{{ $t('nav.logout') }}</span></button>
    </nav>
  </aside>
</template>

<style scoped>
.rail { display: grid; gap: var(--s-4); align-content: start; }
.todo { display: flex; align-items: center; gap: var(--s-3); width: 100%; padding: 14px var(--s-4); border: 0; font: inherit; color: inherit; text-align: start; cursor: pointer; }
.todo__ring { position: relative; flex: none; width: 36px; height: 36px; border-radius: var(--r-pill); background: conic-gradient(var(--accent) 0 var(--p), var(--surface-2) var(--p) 100%); }
.todo__ring span { position: absolute; inset: 4px; display: grid; place-items: center; border-radius: inherit; background: var(--surface); font-size: 11px; font-weight: 700; }
.todo__text { display: grid; gap: 1px; flex: 1; min-width: 0; }
.todo__text strong { font-size: 14px; }
.todo__text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--text-3); }
.todo__arrow, .quick__chevron { flex: none; width: 15px; height: 15px; color: var(--text-3); }
.quick { display: grid; padding: var(--s-2); }
.quick__row { display: flex; align-items: center; gap: var(--s-3); min-height: 44px; padding: 6px 10px; border: 0; border-radius: var(--r-sm); background: none; font: inherit; font-size: 14px; color: var(--text); text-align: start; cursor: pointer; }
.quick__row:hover { background: var(--surface-2); }
.quick__icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 9px; background: var(--surface-2); color: var(--text-2); }
.quick__icon :deep(svg) { width: 17px; height: 17px; }
.quick__icon--accent { background: var(--accent-tint); color: var(--accent-text); }
.quick__icon--gold { background: var(--gold-soft); color: var(--warning-text); }
.quick__icon--discord { background: rgba(88, 101, 242, 0.12); color: #5865f2; }
.quick__icon--plain { background: none; }
.quick__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick__count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: var(--r-pill); background: var(--danger); color: var(--on-danger); font-size: 11.5px; font-weight: 700; line-height: 20px; text-align: center; }
.quick__meta { font-size: 12px; font-weight: 600; color: var(--text-3); white-space: nowrap; }
.quick__meta--ok { color: var(--success); }
.quick__rule { width: calc(100% - 24px); margin: 6px auto; border: 0; border-top: 1px solid var(--line); }
.quick__logout { color: var(--text-3); }
/* 手機：入口排成四欄圖示，不讓一長串清單把分區擠到很下面 */
@media (max-width: 700px) {
  .quick { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; }
  .quick__row { position: relative; flex-direction: column; justify-content: center; gap: 6px; min-height: 76px; padding: 8px 2px; text-align: center; }
  .quick__label { white-space: normal; font-size: 12px; line-height: 1.3; }
  .quick__chevron, .quick__meta, .quick__rule { display: none; }
  .quick__count { position: absolute; top: 4px; right: calc(50% - 26px); }
  .quick__icon--plain { background: var(--surface-2); }
}
</style>
