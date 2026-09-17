<script setup lang="ts">
import {ref, watch} from 'vue';
import {useSession} from '@/lib/session';
import {updateSiteProfile} from '@/lib/api';
const session=useSession();
const editing=ref(false), busy=ref(false), error=ref(false), saved=ref(false);
const name=ref(''), avatar=ref('');
watch(()=>session.profile, p=>{if(!editing.value){name.value=p?.displayName||p?.handle||'';avatar.value=p?.avatarUrl||''}}, {immediate:true});
function begin(){name.value=session.displayName;avatar.value=session.avatarUrl;editing.value=true;saved.value=false;error.value=false}
async function save(){
 busy.value=true;error.value=false;
 try {const token=await session.accessToken();if(!token)throw new Error('expired');session.profile=await updateSiteProfile(token,{displayName:name.value,avatarUrl:avatar.value});editing.value=false;saved.value=true}
 catch {error.value=true}finally{busy.value=false}
}
</script>
<template>
 <section class="panel community-profile">
  <template v-if="!editing"><button class="btn btn--sm" @click="begin">{{ $t('community.edit') }}</button><p v-if="saved" role="status">{{ $t('community.saved') }}</p></template>
  <form v-else @submit.prevent="save">
   <h2>{{ $t('community.edit') }}</h2><p class="subtle">{{ $t('community.hint') }}</p>
   <label>{{ $t('community.name') }}<input v-model="name" required maxlength="60" autocomplete="nickname" :disabled="busy" /></label>
   <label>{{ $t('community.avatar') }}<input v-model="avatar" type="url" placeholder="https://" :disabled="busy" /></label>
   <p v-if="error" role="alert" class="notice notice--error">{{ $t('community.failed') }}</p>
   <div class="actions"><button class="btn" :disabled="busy || !name.trim()">{{ $t('community.save') }}</button><button type="button" class="btn btn--ghost" :disabled="busy" @click="editing=false">{{ $t('linked.cancel') }}</button></div>
  </form>
 </section>
</template>
<style scoped>
.community-profile {padding:var(--s-4)}
form,label {display:grid;gap:var(--s-2)}
form {gap:var(--s-4)}
h2,p {margin:0}
input {width:100%;padding:var(--s-2);border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-2);color:var(--text)}
.actions {display:flex;gap:var(--s-2)}
</style>
