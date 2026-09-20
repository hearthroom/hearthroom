<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { communityRequest, communityRequestId, forgetCommunityRequest } from '@/lib/community';
import { confirmDialog } from '@/lib/confirm';
import { BADGE_ICONS, badgeText, type BadgeDefinition } from '../../../shared/community-badges';
const emit=defineEmits<{changed:[]}>();
const {t,locale}=useI18n(),session=useSession();
type Management={definitions:BadgeDefinition[];audit:{id:string;handle:string;badge:string;action:string;reason:string;at:number}[]};
const data=ref<Management|null>(null),busy=ref(false),error=ref(''),success=ref(false);
const key=ref(''),title=ref(''),description=ref(''),icon=ref<typeof BADGE_ICONS[number]>('award');
const handle=ref(''),badge=ref(''),action=ref('grant'),reason=ref(''),expires=ref('');
async function request(path='',method='GET',body?:unknown){const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));return communityRequest<Management>('/me/community/badges/manage'+path,token,method,body);}
async function run(task:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';success.value=false;try{await task();}catch{error.value=t('badgeWall.manage.failed');}finally{busy.value=false;}}
async function load(){await run(async()=>{data.value=await request();});}
async function create(){await run(async()=>{data.value=await request('/definitions','POST',{key:'event_'+key.value,icon:icon.value,titles:{[locale.value]:title.value},descriptions:{[locale.value]:description.value}});badge.value='event_'+key.value;key.value=title.value=description.value='';success.value=true;emit('changed');});}
async function award(){
 const chosen=data.value?.definitions.find(d=>d.key===badge.value);if(!chosen)return;
 if(action.value==='revoke'&&!await confirmDialog({title:t('badgeWall.manage.revokeTitle'),message:t('badgeWall.manage.revokeConfirm',{name:handle.value,badge:badgeText(chosen.titles,locale.value)}),confirmText:t('badgeWall.manage.revoke'),danger:true}))return;
 await run(async()=>{
  const body={handle:handle.value.trim().replace(/^@/,''),badge:badge.value,action:action.value,reason:reason.value,expiresAt:action.value==='grant'&&expires.value?new Date(expires.value).getTime():null};
  const scope='badges:'+session.profile?.handle;
  const requestId=await communityRequestId(scope,body);
  data.value=await request('/awards','POST',{...body,requestId});await forgetCommunityRequest(scope,body);success.value=true;emit('changed');
 });
}
</script>
<template>
 <details class="badge-manager panel" @toggle="(e)=>{if((e.target as HTMLDetailsElement).open&&!data)load()}">
  <summary>{{ t('badgeWall.manage.title') }}</summary>
  <p class="subtle">{{ t('badgeWall.manage.hint') }}</p>
  <p v-if="error" role="alert" class="notice notice--error">{{ error }} <button class="btn" :disabled="busy" @click="load">{{ t('badgeWall.retry') }}</button></p>
  <p v-if="success" role="status">{{ t('badgeWall.manage.saved') }}</p>
  <div class="badge-manager__forms">
   <form @submit.prevent="create"><h3>{{ t('badgeWall.manage.create') }}</h3>
    <label>{{ t('badgeWall.manage.key') }}<input v-model="key" pattern="[a-z0-9][a-z0-9_]{0,49}" maxlength="50" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.name') }}<input v-model="title" maxlength="60" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.condition') }}<textarea v-model="description" maxlength="300" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.icon') }}<select v-model="icon" :disabled="busy"><option v-for="name in BADGE_ICONS" :key="name" :value="name">{{ t('badgeWall.icon.'+name) }}</option></select></label>
    <button class="btn" :disabled="busy">{{ t('badgeWall.manage.create') }}</button>
   </form>
   <form @submit.prevent="award"><h3>{{ t('badgeWall.manage.award') }}</h3>
    <label>{{ t('badgeWall.manage.member') }}<input v-model="handle" maxlength="64" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.badge') }}<select v-model="badge" required :disabled="busy"><option value="" disabled>{{ t('badgeWall.manage.choose') }}</option><option v-for="item in data?.definitions??[]" :key="item.key" :value="item.key">{{ badgeText(item.titles,locale) }}</option></select></label>
    <label>{{ t('badgeWall.manage.action') }}<select v-model="action" :disabled="busy"><option value="grant">{{ t('badgeWall.manage.grant') }}</option><option value="revoke">{{ t('badgeWall.manage.revoke') }}</option></select></label>
    <label v-if="action==='grant'">{{ t('badgeWall.manage.expires') }}<input v-model="expires" type="datetime-local" :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.reason') }}<input v-model="reason" maxlength="300" required :disabled="busy" /></label>
    <button class="btn" :disabled="busy||!badge">{{ t('badgeWall.manage.submit') }}</button>
   </form>
  </div>
  <h3>{{ t('badgeWall.manage.history') }}</h3><p v-if="!data?.audit.length" class="subtle">{{ t('badgeWall.manage.empty') }}</p>
  <ol v-else class="badge-audit"><li v-for="entry in data.audit" :key="entry.id"><strong>{{ entry.handle }} · {{ badgeText(data.definitions.find(d=>d.key===entry.badge)?.titles??{},locale) }}</strong><span>{{ t('badgeWall.manage.'+entry.action) }} · {{ new Date(entry.at).toLocaleString(locale) }}</span><p>{{ entry.reason }}</p></li></ol>
 </details>
</template>
<style scoped>
.badge-manager:not([open]) > :not(summary){display:none}
.badge-manager{padding:var(--s-5);min-width:0}.badge-manager summary{cursor:pointer;font-weight:600;min-height:2.75rem;line-height:2.75rem}.badge-manager p{line-height:1.6}.badge-manager__forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:var(--s-6)}.badge-manager form{display:grid;gap:var(--s-3);align-content:start;min-width:0}.badge-manager h3{font-size:1rem;margin:var(--s-4) 0}.badge-manager label{display:grid;gap:var(--s-2);color:var(--text-2);font-size:.875rem;min-width:0}.badge-manager input,.badge-manager select,.badge-manager textarea{width:100%;min-width:0;min-height:2.75rem;padding:var(--s-2) var(--s-3);border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--surface);color:var(--text);font:inherit}.badge-manager textarea{min-height:5rem;resize:vertical}.badge-manager .btn{min-height:2.75rem}.badge-audit{padding:0;list-style:none;display:grid;gap:var(--s-3)}.badge-audit li{display:grid;gap:var(--s-1);border-top:1px solid var(--line);padding-top:var(--s-3);overflow-wrap:anywhere}.badge-audit span{font-size:.8125rem;color:var(--text-2)}.badge-audit p{margin:0;font-size:.875rem}
</style>
