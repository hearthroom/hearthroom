<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { communityRequest, communityRequestId, forgetCommunityRequest } from '@/lib/community';
import { confirmDialog } from '@/lib/confirm';
import { BADGE_ICONS, badgeText, type BadgeDefinition } from '../../../shared/community-badges';
/**
 * 活動徽章的發放與建檔。住在社群管理的「成員」分頁；帶 handle 進來就是對著那位成員發。
 * 誰能用由服務端判（manager/owner），這裡不藏按鈕、只把錯誤講清楚。
 */
const props=defineProps<{handle?:string}>();
const emit=defineEmits<{changed:[]}>();
const {t,locale}=useI18n(),session=useSession();
type Management={definitions:BadgeDefinition[];audit:{id:string;handle:string;badge:string;action:string;reason:string;at:number}[]};
const data=ref<Management|null>(null),busy=ref(false),error=ref(''),success=ref(false);
const key=ref(''),title=ref(''),description=ref(''),icon=ref<typeof BADGE_ICONS[number]>('award');
const handle=ref(props.handle??''),badge=ref(''),action=ref('grant'),reason=ref(''),expires=ref('');
watch(()=>props.handle,value=>{if(value)handle.value=value;});
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
  data.value=await request('/awards','POST',{...body,requestId});await forgetCommunityRequest(scope,body);success.value=true;reason.value='';emit('changed');
 });
}
onMounted(load);
</script>
<template>
 <section class="badge-manager" :aria-label="t('badgeWall.manage.title')">
  <p v-if="error" role="alert" class="notice notice--error">{{ error }} <button class="btn btn--sm" :disabled="busy" @click="load">{{ t('badgeWall.retry') }}</button></p>
  <p v-if="success" role="status" class="notice">{{ t('badgeWall.manage.saved') }}</p>
  <div class="badge-manager__forms">
   <form data-badge-award @submit.prevent="award"><h3>{{ t('badgeWall.manage.award') }}</h3>
    <label>{{ t('badgeWall.manage.member') }}<input v-model="handle" maxlength="64" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.badge') }}<select v-model="badge" required :disabled="busy"><option value="" disabled>{{ t('badgeWall.manage.choose') }}</option><option v-for="item in data?.definitions??[]" :key="item.key" :value="item.key">{{ badgeText(item.titles,locale) }}</option></select></label>
    <label>{{ t('badgeWall.manage.action') }}<select v-model="action" :disabled="busy"><option value="grant">{{ t('badgeWall.manage.grant') }}</option><option value="revoke">{{ t('badgeWall.manage.revoke') }}</option></select></label>
    <label v-if="action==='grant'">{{ t('badgeWall.manage.expires') }}<input v-model="expires" type="datetime-local" :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.reason') }}<input v-model="reason" maxlength="300" required :disabled="busy" /></label>
    <button class="btn" :disabled="busy||!badge">{{ t('badgeWall.manage.submit') }}</button>
   </form>
   <form data-badge-create @submit.prevent="create"><h3>{{ t('badgeWall.manage.create') }}</h3>
    <label>{{ t('badgeWall.manage.key') }}<input v-model="key" pattern="[a-z0-9][a-z0-9_]{0,49}" maxlength="50" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.name') }}<input v-model="title" maxlength="60" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.condition') }}<textarea v-model="description" maxlength="300" required :disabled="busy" /></label>
    <label>{{ t('badgeWall.manage.icon') }}<select v-model="icon" :disabled="busy"><option v-for="name in BADGE_ICONS" :key="name" :value="name">{{ t('badgeWall.icon.'+name) }}</option></select></label>
    <button class="btn" :disabled="busy">{{ t('badgeWall.manage.create') }}</button>
   </form>
  </div>
 </section>
</template>
<style scoped>
.badge-manager{display:grid;gap:var(--s-3);min-width:0}.badge-manager p{line-height:1.6;margin:0}.badge-manager__forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:var(--s-5)}.badge-manager form{display:grid;gap:var(--s-3);align-content:start;min-width:0}.badge-manager h3{font-size:1rem;margin:0}.badge-manager label{display:grid;gap:var(--s-2);color:var(--text-2);font-size:.875rem;min-width:0}.badge-manager input,.badge-manager select,.badge-manager textarea{width:100%;min-width:0;min-height:2.75rem;padding:var(--s-2) var(--s-3);border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--surface);color:var(--text);font:inherit}.badge-manager textarea{min-height:5rem;resize:vertical}.badge-manager .btn{min-height:2.75rem;justify-self:start}
</style>
