<script setup lang="ts">
import {useI18n} from 'vue-i18n';
import {RouterLink} from 'vue-router';
import {useLocalePath} from '@/lib/use-locale';
import {formatCredits,type SpendPlayer} from '@/lib/spend-leaderboard';
import SpendAvatar from './SpendAvatar.vue';
import CommunityName from './CommunityName.vue';
defineProps<{player:SpendPlayer;podium?:boolean}>();
const {t,locale}=useI18n(),{lp}=useLocalePath();
</script>
<template><div class="board-player" :class="{'board-player--podium':podium,'board-player--self':player.isSelf,'board-player--wide':formatCredits(player.credits,locale).length>12}" :data-rank="player.rank">
 <span class="board-player__rank" :aria-label="t('spendBoard.rankLabel',{rank:player.rank})">{{ player.rank }}</span>
 <SpendAvatar :player="player" />
 <div class="board-player__name"><RouterLink v-if="!player.anonymous&&player.handle" :to="lp('/authors/'+player.handle)"><CommunityName :handle="player.handle" :name="player.nickname??''" /></RouterLink><CommunityName v-else-if="!player.anonymous" :name="player.nickname??''" /><span v-else class="board-player__anonymous">{{ t('spendBoard.anon') }}</span><small v-if="player.isSelf">{{ t('spendBoard.you') }}</small></div>
 <span class="board-player__amount">{{ t('spendBoard.'+(player.credits==='1'?'pointsAmountOne':'pointsAmount'),{points:formatCredits(player.credits,locale)}) }}</span>
</div></template>
<style scoped>
.board-player{display:grid;grid-template-columns:24px 32px minmax(0,1fr);column-gap:var(--s-2);row-gap:var(--s-1);align-items:center;padding:var(--s-2);border-radius:var(--r-sm);min-width:0}.board-player__rank{font-size:14px;font-weight:700;color:var(--text-2);text-align:center;grid-row:span 2}.board-player>.spend-avatar{grid-row:span 2}.board-player__name{display:flex;align-items:center;gap:var(--s-1);min-width:0;font-size:14px;font-weight:600}.board-player__name>a,.board-player__name>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.board-player__name>a{min-height:var(--h-sm);display:flex;align-items:center}.board-player__name>a>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.board-player__name :deep(.community-name>span:first-child){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.board-player--wide .board-player__amount{grid-column:1/-1;justify-self:end}.board-player__name>span.board-player__anonymous{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:normal}.board-player small{font-size:12px;color:var(--text-2);font-weight:400;flex:none}.board-player__amount{font-size:13px;font-variant-numeric:tabular-nums;grid-column:3;white-space:nowrap;color:var(--text-2)}.board-player--self{background:var(--accent-tint)}.board-player--podium{display:flex;flex-direction:column;padding:var(--s-3) var(--s-1);gap:var(--s-2);text-align:center;background:var(--surface-2);border-radius:var(--r-md)}.board-player--podium>.spend-avatar{width:56px;height:56px}.board-player--podium[data-rank="1"]>.spend-avatar{width:72px;height:72px}.board-player--podium .board-player__rank{order:3;width:100%;min-height:40px;display:flex;align-items:center;justify-content:center;font-size:20px;color:color-mix(in srgb,var(--silver) 40%,var(--text))}.board-player--podium[data-rank="3"] .board-player__rank{color:color-mix(in srgb,var(--bronze) 40%,var(--text))}.board-player--podium[data-rank="1"] .board-player__rank{min-height:64px;color:color-mix(in srgb,var(--gold) 40%,var(--text))}.board-player--podium[data-rank="2"] .board-player__rank{min-height:48px}.board-player--podium .board-player__name{max-width:100%}.board-player--podium .board-player__amount{font-size:12px;width:100%}
</style>
