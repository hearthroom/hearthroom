<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CommunityIcon from './CommunityIcon.vue';
import { badgeText, BADGE_ICONS, type CollectedBadge } from '../../../shared/community-badges';
const props=withDefaults(defineProps<{items:CollectedBadge[];selected?:string[];editable?:boolean;busy?:boolean}>(),{selected:()=>[],editable:false,busy:false});
const emit=defineEmits<{change:[keys:string[]]}>();
const {t,locale}=useI18n();
const items=computed(()=>props.items.filter(b=>BADGE_ICONS.includes(b.icon)));
const date=(time:number)=>new Intl.DateTimeFormat(locale.value,{dateStyle:'medium'}).format(time);
function toggle(key:string){emit('change',props.selected.includes(key)?props.selected.filter(k=>k!==key):[...props.selected,key]);}
</script>
<template>
 <div class="badge-wall" role="list" :aria-label="t('badgeWall.title')">
  <article v-for="badge in items" :key="badge.key" class="badge-tile" :class="{'badge-tile--earned':badge.state==='earned','badge-tile--featured':selected.includes(badge.key)}" role="listitem">
   <div class="badge-tile__top"><span class="badge-tile__icon"><CommunityIcon :name="badge.icon" /></span><span class="badge-tile__state">{{ t('badgeWall.state.'+badge.state) }}</span></div>
   <div><h3>{{ badgeText(badge.titles,locale) }}</h3><p class="badge-tile__condition">{{ badgeText(badge.descriptions,locale) }}</p></div>
   <div class="badge-tile__details">
    <template v-if="badge.progress && badge.state==='locked'"><label>{{ t('badgeWall.progress',{value:badge.progress.value,target:badge.progress.target}) }}<progress :value="badge.progress.value" :max="badge.progress.target" /></label></template>
    <p v-if="badge.earnedAt!==null">{{ t('badgeWall.earnedAt',{date:date(badge.earnedAt)}) }}</p>
    <p v-if="badge.expiresAt!==null">{{ t('badgeWall.expiresAt',{date:date(badge.expiresAt)}) }}</p>
   </div>
   <button v-if="editable && badge.state==='earned'" type="button" class="btn" data-feature :aria-pressed="selected.includes(badge.key)" :disabled="busy || (!selected.includes(badge.key) && selected.length>=3)" @click="toggle(badge.key)">{{ t(selected.includes(badge.key)?'badgeWall.unfeature':'badgeWall.feature') }}</button>
  </article>
 </div>
</template>
<style scoped>
.badge-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr));gap:var(--s-4)}
.badge-tile{display:flex;flex-direction:column;gap:var(--s-4);min-width:0;padding:var(--s-5);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface-2)}
.badge-tile--featured{border-color:var(--accent)}.badge-tile__top{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3)}
.badge-tile__icon{display:flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:var(--r-sm);background:var(--surface);color:var(--text-3)}
.badge-tile__icon svg{width:1.75rem;height:1.75rem}.badge-tile--earned .badge-tile__icon{color:var(--accent-text);background:var(--accent-tint)}
.badge-tile__state,.badge-tile__details{font-size:.8125rem;color:var(--text-2)}.badge-tile__state{overflow-wrap:anywhere;text-align:end}
.badge-tile h3{font-size:1rem;line-height:1.5;margin:0;overflow-wrap:anywhere}.badge-tile p{margin:var(--s-2) 0 0;line-height:1.6;overflow-wrap:anywhere}.badge-tile__condition{white-space:pre-line;color:var(--text-2);font-size:.875rem}
.badge-tile__details{margin-top:auto}.badge-tile__details label{display:grid;gap:var(--s-2)}progress{width:100%;height:.5rem;accent-color:var(--accent)}.badge-tile .btn{width:100%;min-height:2.75rem;white-space:normal;line-height:1.5}.badge-tile .btn[aria-pressed=true]{color:var(--accent-text);border-color:var(--accent)}
</style>
