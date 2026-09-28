<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useReviewer } from '@/lib/review';
import { useLocalePath } from '@/lib/use-locale';
import { moderationRequest, type MemberDetail, type RegistrationPack } from '@/lib/moderation';
import { dateTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';
import { BADGE_ICONS, badgeText } from '../../../shared/community-badges';
import BadgeManager from '@/components/BadgeManager.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';
/**
 * 社群管理的「成員」分頁：發給人的東西都在這裡——登記補充包、活動徽章。
 * 左邊是全站最近發放（也是找人的捷徑），右邊是一位成員：額度、包、徽章、紀錄。
 * 沒有模糊搜尋：輸入公開帳號代號，或從作品管理的作品紀錄點作者進來。
 */
const {t,locale}=useI18n();const route=useRoute();const router=useRouter();const session=useSession();const reviewer=useReviewer();const {lp}=useLocalePath();
const q=ref('');const detail=ref<MemberDetail|null>(null);const recent=ref<RegistrationPack[]>([]);const offset=ref(0);const hasNext=ref(false);
const loading=ref(false);const memberLoading=ref(false);const busy=ref(false);const error=ref('');const done=ref('');
const granted=ref(1);const reason=ref('');const operation=ref(crypto.randomUUID());
const handle=computed(()=>String(route.params.handle??'').replace(/^@/,''));
const validAmount=computed(()=>Number.isInteger(granted.value)&&granted.value>=1&&granted.value<=100);
/** 這位成員身上的管理動作，新的在前：補充包與徽章各自的紀錄併成一條時間軸 */
const timeline=computed(()=>!detail.value?[]:[
 ...detail.value.packs.map(p=>({key:'pack:'+p.id,at:p.at,title:t('moderation.members.packItem',{granted:p.granted,remaining:p.remaining}),reason:p.reason,actor:p.grantedBy})),
 ...detail.value.badgeAudit.map(a=>({key:'badge:'+a.id,at:a.at,title:`${t('badgeWall.manage.'+a.action)} · ${a.titles?badgeText(a.titles,locale.value):a.badge}`,reason:a.reason,actor:a.actor})),
].sort((a,b)=>b.at-a.at));
const iconOf=(icon:string)=>(BADGE_ICONS as readonly string[]).includes(icon)?icon as typeof BADGE_ICONS[number]:'award';
const identity=()=>`${session.me?.accountNumId??''}`;
let generation=0,alive=true;
async function token(){const value=await session.accessToken();if(!value)throw new Error(t('auth.expired'));return value;}
async function loadRecent(){const gen=++generation,who=identity();loading.value=true;try{
 const access=await token();if(!alive||gen!==generation||who!==identity())return;
 const data=await moderationRequest<{items:RegistrationPack[];hasNext:boolean}>(`/packs?offset=${offset.value}`,access);
 if(!alive||gen!==generation||who!==identity())return;recent.value=data.items;hasNext.value=data.hasNext;
 }catch(e){if(gen===generation&&who===identity())error.value=e instanceof Error?e.message:t('state.loadFailed');}finally{if(gen===generation)loading.value=false;}}
async function loadMember(){const who=identity(),target=handle.value;if(!target){detail.value=null;return;}error.value='';memberLoading.value=true;try{
 const access=await token();if(!alive||who!==identity()||target!==handle.value)return;
 const data=await moderationRequest<MemberDetail>(`/members/${encodeURIComponent(target)}`,access);
 if(!alive||who!==identity()||target!==handle.value)return;detail.value=data;q.value=data.member.handle;
 }catch(e){if(who===identity()&&target===handle.value){detail.value=null;error.value=e instanceof Error?e.message:t('state.loadFailed');}}finally{if(target===handle.value)memberLoading.value=false;}}
function lookup(){const target=q.value.trim().replace(/^@/,'');if(target)void router.push(lp('/review/members/'+encodeURIComponent(target)));}
function open(member:string){void router.push(lp('/review/members/'+encodeURIComponent(member)));}
async function grant(){if(busy.value||!detail.value||!reason.value.trim()||!validAmount.value)return;const who=identity(),target=handle.value;busy.value=true;error.value='';done.value='';try{
 const access=await token();if(!alive||who!==identity()||target!==handle.value)return;
 const data=await moderationRequest<MemberDetail>(`/members/${encodeURIComponent(target)}/packs`,access,{granted:granted.value,reason:reason.value.trim(),operationId:operation.value});
 if(!alive||who!==identity()||target!==handle.value)return;
 detail.value=data;done.value=t('moderation.members.grantSaved');operation.value=crypto.randomUUID();reason.value='';offset.value=0;await loadRecent();
 }catch(e){if(who===identity()&&target===handle.value)error.value=e instanceof Error?e.message:t('moderation.error.retry');}finally{if(who===identity())busy.value=false;}}
function page(delta:number){if(loading.value)return;offset.value=Math.max(0,offset.value+delta*30);void loadRecent();}
watch(handle,()=>{done.value='';void loadMember();});
watch(()=>session.me?.accountNumId,()=>{generation++;detail.value=null;recent.value=[];error.value='';done.value='';if(session.me){void loadRecent();void loadMember();}},{flush:'sync'});
onMounted(()=>{document.title=pageTitle(t('moderation.title'));void reviewer.refresh();void loadRecent();void loadMember();});
onBeforeUnmount(()=>{alive=false;generation++;});
</script>
<template>
 <section class="moderation members" :aria-label="t('moderation.tab.members')">
  <p v-if="error" class="notice notice--error" role="alert">{{error}}</p>
  <p v-if="done" class="notice" role="status">{{done}}</p>
  <form class="work-search" @submit.prevent="lookup"><input v-model="q" class="input" type="search" :placeholder="t('moderation.members.search')" :aria-label="t('moderation.members.search')"/><button class="btn btn--primary" :disabled="!q.trim()">{{t('moderation.members.find')}}</button></form>
  <div class="work-grid">
   <section class="work-list" :aria-busy="loading">
    <h2 class="eyebrow work-list__title">{{t('moderation.members.recent')}}</h2>
    <template v-if="loading&&!recent.length"><div v-for="n in 3" :key="n" class="ghost work-ghost"/></template>
    <button v-for="pack in recent" :key="pack.id" :data-pack="pack.id" class="work-item panel" :class="{'work-item--current':pack.member===detail?.member.handle}" @click="open(pack.member)">
     <span class="work-line"><strong>@{{pack.member}}</strong><span class="chip">{{t('moderation.members.packItem',{granted:pack.granted,remaining:pack.remaining})}}</span></span>
     <span>{{pack.reason}}</span><span class="subtle">{{dateTime(pack.at)}} · @{{pack.grantedBy}}</span>
    </button>
    <div v-if="!loading&&!recent.length" class="panel work-empty"><p>{{t('moderation.members.recentEmpty')}}</p></div>
    <div class="work-pager"><button class="btn btn--sm" :disabled="offset===0||loading" @click="page(-1)">{{t('moderation.previous')}}</button><button class="btn btn--sm" :disabled="!hasNext||loading" @click="page(1)">{{t('moderation.next')}}</button></div>
   </section>
   <section class="panel work-detail">
    <template v-if="detail">
     <header class="member-head">
      <img v-if="detail.member.avatarUrl" class="member-avatar" :src="detail.member.avatarUrl" alt=""/>
      <div><h2>{{detail.member.displayName}}</h2><p class="subtle">@{{detail.member.handle}}<span v-if="detail.member.role" class="chip member-role">{{t('moderation.role.'+detail.member.role)}}</span> · {{t('moderation.members.since',{date:new Date(detail.member.memberSince).toLocaleDateString(locale)})}}</p></div>
     </header>
     <dl class="member-quota">
      <div><dt>{{t('mine.quota.eyebrow')}}</dt><dd data-member-quota><strong>{{detail.quota.used}}</strong>/{{detail.quota.limit}} {{t('mine.quota.unit')}}</dd></div>
      <div><dt>{{t('moderation.members.packs')}}</dt><dd data-member-packs>{{t('moderation.members.packsLeft',{n:detail.quota.packRemaining})}}</dd></div>
     </dl>
     <form data-grant-pack class="member-grant" @submit.prevent="grant">
      <h3>{{t('moderation.members.grant')}}</h3><p class="subtle">{{t('moderation.members.grantHint')}}</p>
      <label for="pack-granted">{{t('moderation.members.granted')}}</label><input id="pack-granted" v-model.number="granted" class="input member-grant__amount" type="number" min="1" max="100" step="1" required :disabled="busy"/>
      <label for="pack-reason">{{t('moderation.reason')}}</label><textarea id="pack-reason" v-model="reason" class="input" rows="3" maxlength="2000" :disabled="busy"/>
      <button class="btn btn--primary work-submit" :disabled="busy||!reason.trim()||!validAmount">{{t('moderation.members.grantSubmit')}}</button>
     </form>
     <h3>{{t('moderation.members.badges')}}</h3>
     <ul v-if="detail.badges.length" class="member-badges"><li v-for="b in detail.badges" :key="b.key" class="chip"><CommunityIcon :name="iconOf(b.icon)"/>{{badgeText(b.titles,locale)}}</li></ul>
     <p v-else class="subtle">{{t('moderation.members.noBadges')}}</p>
     <BadgeManager :handle="detail.member.handle" @changed="loadMember"/>
     <h3>{{t('moderation.members.history')}}</h3>
     <ol v-if="timeline.length" class="work-timeline"><li v-for="item in timeline" :key="item.key"><strong>{{item.title}}</strong><p>{{item.reason}}</p><time>{{dateTime(item.at)}} · @{{item.actor}}</time></li></ol>
     <p v-else class="subtle">{{t('moderation.members.noHistory')}}</p>
    </template>
    <div v-else-if="memberLoading" class="work-empty" aria-busy="true"><div class="ghost work-ghost"/><div class="ghost work-ghost"/></div>
    <div v-else class="work-empty"><h2>{{t('moderation.members.select')}}</h2><p class="subtle">{{t('moderation.members.selectHint')}}</p></div>
   </section>
  </div>
 </section>
</template>
<style scoped>
.work-search,.work-pager,.work-line{display:flex;gap:var(--s-2);flex-wrap:wrap;align-items:center;}
.work-search{margin-bottom:var(--s-4);}.work-search .input{flex:1;min-width:180px;}
.work-grid{display:grid;grid-template-columns:minmax(240px,0.85fr) minmax(0,1.4fr);gap:var(--s-4);align-items:start;}
.work-list{display:grid;gap:var(--s-3);}.work-list__title{margin:0;}
.work-item{display:grid;gap:var(--s-2);padding:var(--s-4);width:100%;text-align:start;color:var(--text);font:inherit;cursor:pointer;border:1px solid var(--line);}
.work-item:hover,.work-item:focus-visible,.work-item--current{border-color:var(--accent);background:var(--surface-2);}
.work-line{justify-content:space-between;align-items:start;}
.work-detail{padding:var(--s-5);display:grid;gap:var(--s-3);min-width:0;overflow-wrap:anywhere;}
.work-detail h2{font-size:22px;margin:0;}.work-detail h3{font-size:17px;margin:var(--s-4) 0 0;}.work-detail label{font-size:13px;font-weight:600;}.work-detail .input{width:100%;}.work-submit{justify-self:start;}
.work-timeline{padding-inline-start:var(--s-5);margin:0;display:grid;gap:var(--s-4);font-size:14px;}.work-timeline p{white-space:pre-wrap;margin:var(--s-1) 0;}.work-timeline time{color:var(--text-3);font-size:12px;}
.work-empty{padding:var(--s-5);display:grid;gap:var(--s-3);}.work-ghost{height:110px;border-radius:var(--r-md);}
.member-head{display:flex;gap:var(--s-4);align-items:center;}.member-head p{margin:var(--s-1) 0 0;}.member-avatar{width:56px;height:56px;border-radius:var(--r-pill);object-fit:cover;flex:none;background:var(--surface-2);}.member-role{margin-inline-start:var(--s-2);}
.member-quota{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:var(--s-3);margin:0;padding:var(--s-4);background:var(--surface-2);border-radius:var(--r-md);}
.member-quota dt{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-2);}.member-quota dd{margin:var(--s-1) 0 0;font-variant-numeric:tabular-nums;}.member-quota strong{font-size:22px;}
.member-grant{display:grid;gap:var(--s-2);padding-block:var(--s-3);border-block:1px solid var(--line);}.member-grant h3{margin:0;}.member-grant p{margin:0;}.member-grant__amount{max-width:10rem;}
.member-badges{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--s-2);}.member-badges .chip{display:inline-flex;align-items:center;gap:var(--s-1);}.member-badges svg{width:1em;height:1em;}
@media(max-width:760px){.members .btn,.members input,.members select{min-height:44px;}.work-grid{grid-template-columns:minmax(0,1fr);}.work-detail{padding:var(--s-4);}.work-list{max-height:45vh;overflow:auto;padding:2px;}}
</style>
