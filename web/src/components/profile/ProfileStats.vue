<script setup lang="ts">
/**
 * 主頁數據列：作品、關注、粉絲、被聊過（順序固定）。他人看的作者頁、本人的「我的」頁、設定頁的預覽共用這一份，
 * 三處長相不漂移（任務 2026-11-19-profile-visibility ui.md §3.1）。
 *
 * 每格三種狀態：可開名單（整格是按鈕、右上一個 ›）、只有數字、隱藏（只有關注：數字位置換成遮眼圖示）。
 * 遮眼圖示佔數字那一行、行高固定，三種狀態列高一樣，切換時畫面不跳。
 * 版面看容器寬度，不看視窗：同一列在設定頁預覽（較窄）和主頁（較寬）都要排得對。
 */
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import AccountIcon from '@/components/AccountIcon.vue';
import { statAbbreviated, statCount } from '@/lib/format';

type Kind = 'following' | 'followers';
const props = defineProps<{
  works: number;
  chats: number;
  followers: number;
  /** null＝作者設成不公開 */
  following: number | null;
  followingOpen?: boolean;
  followersOpen?: boolean;
  /** 設定頁的預覽：照他人看到的樣子畫出 ›，但不能點 */
  preview?: boolean;
  /** 本人看自己的主頁：99,999 以內寫全數（預覽照他人看到的畫，不傳） */
  own?: boolean;
}>();
const emit = defineEmits<{ open: [kind: Kind, from: HTMLElement] }>();
const { t, locale } = useI18n();

const cells = computed(() => [
  { key: 'works', icon: 'cards' as const, value: props.works, allowed: false },
  { key: 'following', icon: 'users' as const, value: props.following, allowed: !!props.followingOpen && props.following !== null },
  { key: 'followers', icon: 'heart' as const, value: props.followers, allowed: !!props.followersOpen },
  { key: 'chats', icon: 'chat' as const, value: props.chats, allowed: false },
].map((c) => ({ ...c, open: c.allowed && !props.preview, shown: c.allowed && props.preview })));
const label = (key: string) => t('profile.stat.' + key);
const shown = (n: number) => statCount(n, { own: props.own });
const exact = (n: number) => n.toLocaleString(locale.value);
// 預覽只是看樣子，不能點（跟 › 一樣）；縮寫的值仍可滑過看 title
const abbreviated = (n: number) => statAbbreviated(n, { own: props.own });

/*
 * 縮寫的數字可以點開看確切值（ui.md §4）。氣泡放在 .pstats 底下而不是格子裡：
 * 格線容器為了圓角設了 overflow:hidden，放在格子裡會被切掉。點外面、Esc、再點一次關閉，不自動消失。
 */
const root = ref<HTMLElement | null>(null);
const bubbleId = useId();
const open = ref<{ key: string; text: string; left: number; top: number; right: boolean } | null>(null);
let opener: HTMLElement | null = null;
function toggleExact(key: string, value: number, event: MouseEvent) {
  if (open.value?.key === key) return closeExact(false);
  const button = event.currentTarget as HTMLElement;
  const box = root.value!.getBoundingClientRect();
  const at = button.getBoundingClientRect();
  // 右半邊的格子靠右對齊，手機兩欄時不超出螢幕
  const right = at.left + at.width / 2 > box.left + box.width / 2;
  open.value = { key, text: exact(value), left: right ? box.right - at.right : at.left - box.left, top: at.bottom - box.top + 6, right };
  opener = button;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey);
}
function closeExact(refocus: boolean) {
  open.value = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey);
  if (refocus) void nextTick(() => opener?.focus());
}
function onOutside(e: Event) {
  const target = e.target as Node;
  if (opener?.contains(target) || root.value?.querySelector('.pstats__exact')?.contains(target)) return;
  closeExact(false);
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeExact(true); }
onBeforeUnmount(() => closeExact(false));
</script>

<template>
  <div ref="root" class="pstats">
    <div class="pstats__grid" role="list" :aria-label="$t('profile.statsLabel')">
      <div v-for="c in cells" :key="c.key" role="listitem" class="pstats__cell">
        <button
          v-if="c.open"
          type="button"
          class="pstats__stat pstats__stat--open"
          :aria-label="$t('profile.stat.openListAria', { label: label(c.key), count: (c.value ?? 0).toLocaleString(locale) })"
          :title="exact(c.value ?? 0)"
          @click="emit('open', c.key as Kind, $event.currentTarget as HTMLElement)"
        >
          <span class="pstats__label"><AccountIcon :name="c.icon" /><span class="pstats__text">{{ label(c.key) }}</span>
            <svg class="pstats__more" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <strong>{{ shown(c.value ?? 0) }}</strong>
        </button>
        <div v-else class="pstats__stat">
          <span class="pstats__label"><AccountIcon :name="c.icon" /><span class="pstats__text">{{ label(c.key) }}</span>
            <svg v-if="c.shown" class="pstats__more" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <span v-if="c.value === null" class="pstats__hidden" role="img" :aria-label="$t('profile.stat.followingHidden')" :title="$t('profile.stat.followingHidden')"><AccountIcon name="eyeOff" /></span>
          <button
            v-else-if="abbreviated(c.value) && !preview"
            type="button"
            class="pstats__num"
            :title="exact(c.value)"
            :aria-label="`${label(c.key)} ${exact(c.value)}`"
            :aria-expanded="open?.key === c.key"
            :aria-controls="open?.key === c.key ? bubbleId : undefined"
            @click="toggleExact(c.key, c.value, $event)"
          ><strong>{{ shown(c.value) }}</strong></button>
          <strong v-else :title="abbreviated(c.value) ? exact(c.value) : undefined">{{ shown(c.value) }}</strong>
        </div>
      </div>
    </div>
    <span
      v-if="open"
      :id="bubbleId"
      class="pstats__exact"
      role="status"
      :style="open.right ? { right: open.left + 'px', top: open.top + 'px' } : { left: open.left + 'px', top: open.top + 'px' }"
    >{{ open.text }}</span>
  </div>
</template>

<style scoped>
.pstats { container-type: inline-size; position: relative; }
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
/* 縮寫的數字：可點開看確切值，淺虛線提示可點；點擊區用偽元素往外擴，不改版面 */
.pstats__num { position: relative; justify-self: start; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer;
  text-decoration: underline dashed var(--line-strong); text-decoration-thickness: 1px; text-underline-offset: 6px; }
.pstats__num::after { content: ""; position: absolute; inset: -8px; }
.pstats__num:hover { text-decoration-color: var(--text-3); }
/* 確切數字的氣泡：跟浮層選單同一套表面（z 40、--r-md、--shadow-md），可選取複製 */
.pstats__exact { position: absolute; z-index: 40; padding: 6px 10px; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-md), 0 0 0 1px var(--line);
  font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; user-select: text; }
/* 遮眼圖示佔數字那一行：行高與數字相同，三種狀態列高一樣。--text-3 的細線放在粗數字旁像沒載入，用 --text-2 */
.pstats__hidden { display: flex; align-items: center; height: 32px; color: var(--text-2); }
.pstats__hidden svg { width: 22px; height: 22px; }
@container (max-width: 560px) {
  .pstats__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pstats__cell:nth-child(3) { box-shadow: inset 0 1px 0 var(--line); }
  .pstats__cell:nth-child(4) { box-shadow: inset 1px 1px 0 var(--line); }
}
</style>
