<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CommunityIcon from './CommunityIcon.vue';
import RankBadge from './RankBadge.vue';
import { honorName, parseHonorKey, periodLabel, timesLabel } from '@/lib/honors';
import { badgeRarity } from '@/lib/badge-rarity';
import { badgeText, BADGE_ICONS, FEATURED_LIMIT, type CollectedBadge } from '../../../shared/community-badges';
type Item=CollectedBadge&{lastPeriod?:string|null};
const props=withDefaults(defineProps<{items:Item[];selected?:string[];editable?:boolean;busy?:boolean}>(),{selected:()=>[],editable:false,busy:false});
const emit=defineEmits<{change:[keys:string[]]}>();
const {t,locale}=useI18n();
const items=computed(()=>props.items.filter(b=>BADGE_ICONS.includes(b.icon)).map(b=>({...b,rarity:badgeRarity(b)})));
const date=(time:number)=>new Intl.DateTimeFormat(locale.value,{dateStyle:'medium'}).format(time);
/** 榜單榮譽：名稱由榜別、期別、名次組出來（各語系字序在語系檔），日期寫「最近一次是哪一組」；其他徽章照伺服器的名稱與取得日 */
const honorOf=(b:CollectedBadge)=>parseHonorKey(b.key);
const nameOf=(b:CollectedBadge)=>{const h=honorOf(b);return h?honorName(t,h):badgeText(b.titles,locale.value);};
function recent(b:Item):string{const h=honorOf(b);if(!h||!b.lastPeriod||b.state!=='earned')return '';const period=periodLabel(h.window,b.lastPeriod,locale.value);return (b.count??1)>1?t('honor.recentMany',{n:b.count,period}):t('honor.periodSingle',{period});}
function toggle(key:string){emit('change',props.selected.includes(key)?props.selected.filter(k=>k!==key):[...props.selected,key]);}
</script>
<template>
 <div class="badge-wall" role="list" :aria-label="t('badgeWall.title')">
  <article v-for="badge in items" :key="badge.key" class="badge-tile" :class="['badge-tile--'+badge.rarity,{'badge-tile--earned':badge.state==='earned','badge-tile--featured':selected.includes(badge.key)}]" role="listitem">
   <div class="badge-tile__top">
    <!-- 稀有度底座（AI 生圖，中央深色圓盤佔 56%）上疊徽章本身的圖示或榜單徽章 -->
    <span class="badge-tile__emblem">
     <span class="badge-tile__medal">
      <span v-if="honorOf(badge)" class="badge-tile__stack">
       <!-- 拿過多次：後面疊一到兩枚同形的灰色徽章，往右上各偏 4px；次數寫在底座右下，不蓋住徽章裡的名次 -->
       <RankBadge v-for="n in Math.min(badge.count??1,3)-1" :key="n" :honor="honorOf(badge)!" decorative class="badge-tile__ghost" :style="{transform:`translate(${n*4}px,${-n*4}px)`,zIndex:-n}" />
       <RankBadge :honor="honorOf(badge)!" decorative />
      </span>
      <!-- 彩繪圖示（AI 生圖，public/badges/icons/）；Discord 是品牌標誌，照官方線條畫 -->
      <span v-else-if="badge.icon!=='discord'" class="badge-tile__art" :style="{backgroundImage:`url(/badges/icons/${badge.icon}.webp)`}" />
      <CommunityIcon v-else :name="badge.icon" />
     </span>
     <span v-if="honorOf(badge)&&timesLabel(badge.count)" class="badge-tile__times">{{ timesLabel(badge.count) }}</span>
    </span>
    <span class="badge-tile__meta"><span class="badge-tile__rarity">{{ t('badgeWall.rarity.'+badge.rarity) }}</span><span class="badge-tile__state">{{ t('badgeWall.state.'+badge.state) }}</span></span>
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
/*
 * 稀有度四階：底座圖、名稱色（--ink→--ink-2 漸層，普通與稀有兩端同色）、圖示色（壓在深色圓盤上，深淺模式同一組）、外框與光暈。
 * 只有已取得的才上色、上光；沒拿到的保留稀有度標籤讓人知道值不值得追，其餘轉灰。
 */
.badge-tile{--medal:url(/badges/medal-common.webp);--ink:var(--text);--ink-2:var(--ink);--glyph:#ead7b6;--glow:rgba(176,128,72,.25);position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;gap:var(--s-4);min-width:0;padding:var(--s-5);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface-2)}
.badge-tile--rare{--medal:url(/badges/medal-rare.webp);--ink:#1d5bd6;--glyph:#a8cbff;--glow:rgba(64,128,255,.4)}
.badge-tile--epic{--medal:url(/badges/medal-epic.webp);--aura:url(/badges/aura-epic.webp);--ink:#6d28d9;--ink-2:#b0207a;--glyph:#e2c2ff;--glow:rgba(170,90,255,.5)}
.badge-tile--legendary{--medal:url(/badges/medal-legendary.webp);--aura:url(/badges/aura-legendary.webp);--ink:#9a5800;--ink-2:#b86e00;--glyph:#ffe08a;--glow:rgba(242,176,30,.6)}
:root[data-mode="dark"] .badge-tile--rare{--ink:#8ab8ff}
:root[data-mode="dark"] .badge-tile--epic{--ink:#cfa6ff;--ink-2:#ff8fd6}
:root[data-mode="dark"] .badge-tile--legendary{--ink:#ffe08a;--ink-2:#ffb02e}
.badge-tile--rare.badge-tile--earned{border-color:color-mix(in srgb,#4080ff 45%,transparent);background:radial-gradient(120% 80% at 100% 0%,rgba(64,128,255,.12),transparent 60%),var(--surface-2)}
.badge-tile--epic.badge-tile--earned{border-color:transparent;background:radial-gradient(120% 80% at 100% 0%,rgba(170,90,255,.12),transparent 60%) padding-box,linear-gradient(var(--surface-2),var(--surface-2)) padding-box,linear-gradient(135deg,#b46bff,#ff6fb5 55%,#6b4cff) border-box;box-shadow:0 10px 28px -14px rgba(170,90,255,.6)}
.badge-tile--legendary.badge-tile--earned{border-color:transparent;background:radial-gradient(120% 80% at 100% 0%,rgba(242,176,30,.14),transparent 60%) padding-box,linear-gradient(var(--surface-2),var(--surface-2)) padding-box,linear-gradient(135deg,#ffe28a,#f2b01e 35%,#b8741a 65%,#ffe28a) border-box;box-shadow:0 12px 32px -14px rgba(242,176,30,.7)}
/* 史詩、傳說的卡面右上角疊一層光紋（AI 生圖，透明底） */
.badge-tile--earned::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--aura,none) right top/95% auto no-repeat;opacity:.35;pointer-events:none}
:root[data-mode="dark"] .badge-tile--earned::before{opacity:.6}
/* 傳說：一道很淡的光每隔幾秒掃過卡面；減少動態時不掃 */
.badge-tile--legendary.badge-tile--earned::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 38%,rgba(255,232,160,.22) 50%,transparent 62%);transform:translateX(-100%);animation:badge-sheen 6s ease-in-out infinite;pointer-events:none}
@keyframes badge-sheen{0%,55%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.badge-tile--legendary.badge-tile--earned::after{display:none}}
.badge-tile--featured{outline:2px solid var(--accent);outline-offset:2px}
.badge-tile__top{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3)}
.badge-tile__emblem{position:relative;flex:none;margin:-8px 0 -8px -10px}
/* 底座 96px，中央圓盤約 54px：彩繪圖示 44px（可略出圓盤）、線條圖示 28px、榜單徽章 32px 高 */
.badge-tile__medal{display:grid;place-items:center;width:6rem;height:6rem;background:var(--medal) center/contain no-repeat;color:var(--glyph);--rank-badge-h:32px}
.badge-tile__medal>svg{width:1.75rem;height:1.75rem;filter:drop-shadow(0 0 6px var(--glow))}
.badge-tile__art{width:2.75rem;height:2.75rem;background:center/contain no-repeat;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
.badge-tile--earned .badge-tile__medal{filter:drop-shadow(0 6px 12px var(--glow))}
.badge-tile:not(.badge-tile--earned) .badge-tile__medal{filter:grayscale(1) opacity(.5)}
.badge-tile__stack{position:relative;display:flex;isolation:isolate}.badge-tile__ghost{position:absolute;left:0;top:0;filter:grayscale(1);opacity:.35}
.badge-tile__times{position:absolute;right:2px;bottom:8px;min-width:20px;height:20px;padding:0 6px;border-radius:var(--r-pill);background:var(--text);color:var(--hr-page-bg);font-size:12px;font-weight:700;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}
.badge-tile__meta{display:grid;justify-items:end;gap:var(--s-2);min-width:0}
.badge-tile__rarity{padding:2px 9px;border-radius:var(--r-pill);color:var(--ink);background:color-mix(in srgb,var(--ink) 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 28%,transparent);font-size:12px;font-weight:700;letter-spacing:.04em;line-height:1.6;white-space:nowrap}
.badge-tile__state,.badge-tile__details{font-size:.8125rem;color:var(--text-2)}.badge-tile__state{overflow-wrap:anywhere;text-align:end}
.badge-tile h3{font-size:1rem;line-height:1.5;margin:0;overflow-wrap:anywhere}.badge-tile p{margin:var(--s-2) 0 0;line-height:1.6;overflow-wrap:anywhere}.badge-tile__condition{white-space:pre-line;color:var(--text-2);font-size:.875rem}
.badge-tile--earned h3{width:fit-content;max-width:100%;font-weight:700;background:linear-gradient(90deg,var(--ink),var(--ink-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.badge-tile--legendary.badge-tile--earned h3{font-size:1.0625rem;font-weight:800;letter-spacing:.02em}
.badge-tile:not(.badge-tile--earned) h3{color:var(--text-2)}
.badge-tile--common progress{accent-color:var(--accent)}
.badge-tile__details{margin-top:auto}.badge-tile__details label{display:grid;gap:var(--s-2)}progress{width:100%;height:.5rem;accent-color:var(--ink)}.badge-tile .btn{width:100%;min-height:2.75rem;white-space:normal;line-height:1.5}.badge-tile .btn[aria-pressed=true]{color:var(--accent-text);border-color:var(--accent)}
/* 韓文不在詞中換行 */
.badge-tile h3:lang(ko),.badge-tile p:lang(ko){word-break:keep-all}
</style>
