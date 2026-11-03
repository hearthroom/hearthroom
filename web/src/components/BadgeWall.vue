<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CommunityIcon from './CommunityIcon.vue';
import RankBadge from './RankBadge.vue';
import { honorName, parseHonorKey, periodLabel, timesLabel } from '@/lib/honors';
import { badgeText, BADGE_ICONS, FEATURED_LIMIT, type CollectedBadge } from '../../../shared/community-badges';
type Item=CollectedBadge&{lastPeriod?:string|null};
const props=withDefaults(defineProps<{items:Item[];selected?:string[];editable?:boolean;busy?:boolean}>(),{selected:()=>[],editable:false,busy:false});
const emit=defineEmits<{change:[keys:string[]]}>();
const {t,locale}=useI18n();
const items=computed(()=>props.items.filter(b=>BADGE_ICONS.includes(b.icon)));
const date=(time:number)=>new Intl.DateTimeFormat(locale.value,{dateStyle:'medium'}).format(time);
/** 榜單榮譽：名稱由榜別、期別、名次組出來（各語系字序在語系檔），日期寫「最近一次是哪一組」；其他徽章照伺服器的名稱與取得日 */
const honorOf=(b:CollectedBadge)=>parseHonorKey(b.key);
const nameOf=(b:CollectedBadge)=>{const h=honorOf(b);return h?honorName(t,h):badgeText(b.titles,locale.value);};
function recent(b:Item):string{const h=honorOf(b);if(!h||!b.lastPeriod||b.state!=='earned')return '';const period=periodLabel(h.window,b.lastPeriod,locale.value);return (b.count??1)>1?t('honor.recentMany',{n:b.count,period}):t('honor.periodSingle',{period});}
function toggle(key:string){emit('change',props.selected.includes(key)?props.selected.filter(k=>k!==key):[...props.selected,key]);}
</script>
<template>
 <div class="badge-wall" role="list" :aria-label="t('badgeWall.title')">
  <article v-for="badge in items" :key="badge.key" class="badge-tile" :class="{'badge-tile--earned':badge.state==='earned','badge-tile--featured':selected.includes(badge.key)}" role="listitem">
   <div class="badge-tile__top">
    <span v-if="honorOf(badge)" class="badge-tile__honor">
     <span class="badge-tile__stack">
      <!-- 拿過多次：後面疊一到兩枚同形的灰色徽章，往右上各偏 4px；次數寫在旁邊，不蓋住徽章裡的名次 -->
      <RankBadge v-for="n in Math.min(badge.count??1,3)-1" :key="n" :honor="honorOf(badge)!" decorative class="badge-tile__ghost" :style="{transform:`translate(${n*4}px,${-n*4}px)`,zIndex:-n}" />
      <RankBadge :honor="honorOf(badge)!" decorative />
     </span>
     <span v-if="timesLabel(badge.count)" class="badge-tile__times">{{ timesLabel(badge.count) }}</span>
    </span>
    <span v-else class="badge-tile__icon"><CommunityIcon :name="badge.icon" /></span>
    <span class="badge-tile__state">{{ t('badgeWall.state.'+badge.state) }}</span>
   </div>
   <div><h3>{{ nameOf(badge) }}</h3><p class="badge-tile__condition">{{ badgeText(badge.descriptions,locale) }}</p></div>
   <div class="badge-tile__details">
    <template v-if="badge.progress && badge.state==='locked'"><label>{{ t(badge.progress.unit?'badgeWall.progress.'+badge.progress.unit:'badgeWall.progress',{value:Math.floor(badge.progress.value),target:badge.progress.target}) }}<progress :value="Math.floor(badge.progress.value)" :max="badge.progress.target" /></label></template>
    <p v-if="recent(badge)">{{ recent(badge) }}</p>
    <p v-else-if="badge.earnedAt!==null">{{ t('badgeWall.earnedAt',{date:date(badge.earnedAt)}) }}</p>
    <p v-if="badge.expiresAt!==null">{{ t('badgeWall.expiresAt',{date:date(badge.expiresAt)}) }}</p>
   </div>
   <button v-if="editable && badge.state==='earned'" type="button" class="btn" data-feature :aria-pressed="selected.includes(badge.key)" :disabled="busy || (!selected.includes(badge.key) && selected.length>=FEATURED_LIMIT)" @click="toggle(badge.key)">{{ t(selected.includes(badge.key)?'badgeWall.unfeature':'badgeWall.feature') }}</button>
  </article>
 </div>
</template>
<style scoped>
.badge-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr));gap:var(--s-4)}
.badge-tile{display:flex;flex-direction:column;gap:var(--s-4);min-width:0;padding:var(--s-5);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface-2)}
.badge-tile--featured{border-color:var(--accent)}.badge-tile__top{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3)}
.badge-tile__icon{display:flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:var(--r-sm);background:var(--surface);color:var(--text-3)}
.badge-tile__icon svg{width:1.75rem;height:1.75rem}
/* 榜單榮譽磚：大徽章（38×43）；拿過多次時後面疊一到兩枚灰色同形輪廓往右上偏 4px，次數膠囊在右下 */
.badge-tile__honor{display:flex;align-items:flex-end;gap:10px;--rank-badge-h:43px;padding:8px 8px 0 0}
.badge-tile__stack{position:relative;display:flex;isolation:isolate}.badge-tile__ghost{position:absolute;left:0;top:0;filter:grayscale(1);opacity:.35}
.badge-tile__times{min-width:20px;height:20px;padding:0 6px;border-radius:var(--r-pill);background:var(--text);color:var(--bg);font-size:12px;font-weight:700;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}
.badge-tile:not(.badge-tile--earned) .badge-tile__stack>svg{filter:grayscale(1);opacity:.4}.badge-tile--earned .badge-tile__icon{color:var(--accent-text);background:var(--accent-tint)}
.badge-tile__state,.badge-tile__details{font-size:.8125rem;color:var(--text-2)}.badge-tile__state{overflow-wrap:anywhere;text-align:end}
.badge-tile h3{font-size:1rem;line-height:1.5;margin:0;overflow-wrap:anywhere}.badge-tile p{margin:var(--s-2) 0 0;line-height:1.6;overflow-wrap:anywhere}.badge-tile__condition{white-space:pre-line;color:var(--text-2);font-size:.875rem}
.badge-tile__details{margin-top:auto}.badge-tile__details label{display:grid;gap:var(--s-2)}progress{width:100%;height:.5rem;accent-color:var(--accent)}.badge-tile .btn{width:100%;min-height:2.75rem;white-space:normal;line-height:1.5}.badge-tile .btn[aria-pressed=true]{color:var(--accent-text);border-color:var(--accent)}
/* 韓文不在詞中換行 */
.badge-tile h3:lang(ko),.badge-tile p:lang(ko){word-break:keep-all}
</style>
