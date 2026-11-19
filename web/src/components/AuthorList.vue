<script setup lang="ts">
/**
 * 搜尋作者的結果列（任務 2026-11-19-profile-visibility ui.md §3.6）：作品、關注、粉絲、被聊過。
 * 關注設成不公開的作者，數字位置換成遮眼圖示，欄寬與高度不變。整列連到作者頁，欄位本身不可點。
 * 容器窄時（手機）拆成兩行：身分一行，作品／關注／粉絲一行；被聊過只在寬版出現。
 */
import { RouterLink } from "vue-router";
import AccountIcon from "@/components/AccountIcon.vue";
import { hueFrom, statCount } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import type { Author } from "@/lib/types";

defineProps<{ authors: Author[] }>();
const { lp } = useLocalePath();
</script>

<template>
  <ol class="al">
    <li v-for="a in authors" :key="a.handle ?? a.accountNumId">
      <component :is="a.handle ? RouterLink : 'div'" :to="a.handle ? lp(`/authors/${a.handle}`) : undefined" class="al__row">
        <img v-if="a.avatar" :src="a.avatar" alt="" class="al__face" />
        <span v-else class="al__face mono" :style="{ '--h': hueFrom(a.name) }">{{ [...a.name][0] }}</span>
        <span class="al__who">
          <strong class="al__name">{{ a.name }}</strong>
          <span v-if="a.handle" class="al__id">@{{ a.handle }}</span>
        </span>
        <span class="al__nums">
          <span class="al__num"><strong>{{ statCount(a.cardCount) }}</strong><span>{{ $t("profile.stat.works") }}</span></span>
          <span class="al__num">
            <span v-if="a.following === null" class="al__hidden" role="img" :aria-label="$t('profile.stat.followingHidden')" :title="$t('profile.stat.followingHidden')"><AccountIcon name="eyeOff" /></span>
            <strong v-else>{{ statCount(a.following ?? 0) }}</strong>
            <span>{{ $t("profile.stat.following") }}</span>
          </span>
          <span class="al__num"><strong>{{ statCount(a.followers ?? 0) }}</strong><span>{{ $t("profile.stat.followers") }}</span></span>
          <span class="al__num al__num--soft"><strong>{{ statCount(a.talkTotal) }}</strong><span>{{ $t("profile.stat.chats") }}</span></span>
        </span>
        <svg class="al__arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </component>
    </li>
  </ol>
</template>

<style scoped>
.al { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; container-type: inline-size; }
.al__row {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--s-4);
  padding: 10px 14px;
  background: var(--surface); border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm);
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.al__row:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); transform: translateY(-1px); }
.al__face { width: 40px; height: 40px; border-radius: var(--r-pill); object-fit: cover; font-size: 16px; }
.al__who { display: grid; min-width: 0; line-height: 1.35; }
.al__name { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al__id { font-size: 13px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al__nums { display: flex; gap: var(--s-4); }
.al__num { display: grid; justify-items: end; text-align: right; line-height: 1.3; min-width: 4.5em; }
.al__num strong { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.al__num > span:last-child { font-size: 12px; color: var(--text-3); white-space: nowrap; }
.al__num--soft strong { font-weight: 500; color: var(--text-2); }
/* 遮眼圖示跟數字同一行高，欄位不跳 */
.al__hidden { display: flex; align-items: center; height: calc(15px * 1.3); color: var(--text-2); }
.al__hidden svg { width: 16px; height: 16px; }
.al__arrow { width: 16px; height: 16px; color: var(--text-3); transition: transform var(--dur) var(--ease), color var(--dur) var(--ease); }
.al__row:hover .al__arrow { transform: translateX(3px); color: var(--accent-text); }
@container (max-width: 640px) {
  .al__row { grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--s-2) var(--s-3); }
  .al__nums { grid-column: 1 / -1; grid-row: 2; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); padding-top: var(--s-2); box-shadow: inset 0 1px 0 var(--line); }
  .al__num { justify-items: start; text-align: left; min-width: 0; }
  .al__num--soft { display: none; }
  .al__arrow { grid-column: 3; grid-row: 1; }
}
</style>
