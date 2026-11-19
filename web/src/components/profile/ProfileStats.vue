<script setup lang="ts">
/**
 * 主頁數據列：作品、關注、粉絲、被聊過（順序固定）。他人看的作者頁、本人的「我的」頁、設定頁的預覽共用這一份，
 * 三處長相不漂移（任務 2026-11-19-profile-visibility ui.md §3.1）。
 *
 * 每格三種狀態：可開名單（整格是按鈕、右上一個 ›）、只有數字、隱藏（只有關注：數字位置換成遮眼圖示）。
 * 遮眼圖示佔數字那一行、行高固定，三種狀態列高一樣，切換時畫面不跳。
 * 版面看容器寬度，不看視窗：同一列在設定頁預覽（較窄）和主頁（較寬）都要排得對。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AccountIcon from '@/components/AccountIcon.vue';
import { compact } from '@/lib/format';

type Kind = 'following' | 'followers';
const props = defineProps<{
  works: number;
  chats: number;
  followers: number;
  /** null＝作者設成不公開 */
  following: number | null;
  followingOpen?: boolean;
  followersOpen?: boolean;
}>();
const emit = defineEmits<{ open: [kind: Kind, from: HTMLElement] }>();
const { t, locale } = useI18n();

const cells = computed(() => [
  { key: 'works', icon: 'cards' as const, value: props.works, open: false },
  { key: 'following', icon: 'users' as const, value: props.following, open: !!props.followingOpen && props.following !== null },
  { key: 'followers', icon: 'heart' as const, value: props.followers, open: !!props.followersOpen },
  { key: 'chats', icon: 'chat' as const, value: props.chats, open: false },
]);
const label = (key: string) => t('profile.stat.' + key);
</script>

<template>
  <div class="pstats">
    <div class="pstats__grid" role="list" :aria-label="$t('profile.statsLabel')">
      <div v-for="c in cells" :key="c.key" role="listitem" class="pstats__cell">
        <button
          v-if="c.open"
          type="button"
          class="pstats__stat pstats__stat--open"
          :aria-label="$t('profile.stat.openListAria', { label: label(c.key), count: (c.value ?? 0).toLocaleString(locale) })"
          @click="emit('open', c.key as Kind, $event.currentTarget as HTMLElement)"
        >
          <span class="pstats__label"><AccountIcon :name="c.icon" /><span class="pstats__text">{{ label(c.key) }}</span>
            <svg class="pstats__more" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <strong>{{ compact(c.value ?? 0) }}</strong>
        </button>
        <div v-else class="pstats__stat">
          <span class="pstats__label"><AccountIcon :name="c.icon" /><span class="pstats__text">{{ label(c.key) }}</span></span>
          <span v-if="c.value === null" class="pstats__hidden" role="img" :aria-label="$t('profile.stat.followingHidden')" :title="$t('profile.stat.followingHidden')"><AccountIcon name="eyeOff" /></span>
          <strong v-else>{{ compact(c.value) }}</strong>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pstats { container-type: inline-size; }
.pstats__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-radius: var(--r-md); box-shadow: 0 0 0 1px var(--line); overflow: hidden; }
.pstats__cell { display: grid; min-width: 0; }
.pstats__cell + .pstats__cell { box-shadow: inset 1px 0 0 var(--line); }
.pstats__stat { display: grid; gap: 6px; min-width: 0; padding: var(--s-4) var(--s-5); border: 0; background: none; font: inherit; color: inherit; text-align: start; }
.pstats__stat--open { cursor: pointer; transition: background var(--dur) var(--ease); }
.pstats__stat--open:hover { background: var(--surface-2); }
.pstats__label { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--text-2); white-space: nowrap; }
.pstats__label > svg:first-child { width: 16px; height: 16px; flex: none; color: var(--text-3); }
.pstats__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pstats__more { width: 12px; height: 12px; flex: none; margin-left: auto; color: var(--text-3); transition: transform var(--dur) var(--ease), color var(--dur) var(--ease); }
.pstats__stat--open:hover .pstats__more { transform: translateX(2px); color: var(--accent-text); }
.pstats__stat strong { font-size: 24px; font-weight: 750; line-height: 32px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
/* 遮眼圖示佔數字那一行：行高與數字相同，三種狀態列高一樣。--text-3 的細線放在粗數字旁像沒載入，用 --text-2 */
.pstats__hidden { display: flex; align-items: center; height: 32px; color: var(--text-2); }
.pstats__hidden svg { width: 22px; height: 22px; }
@container (max-width: 560px) {
  .pstats__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pstats__cell:nth-child(3) { box-shadow: inset 0 1px 0 var(--line); }
  .pstats__cell:nth-child(4) { box-shadow: inset 1px 1px 0 var(--line); }
}
</style>
