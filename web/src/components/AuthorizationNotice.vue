<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {managedAuth} from '@/lib/managed-auth';
const managed=ref(false);
onMounted(async()=>{try{managed.value=await managedAuth();}catch{/* Login reports unavailable configuration. */}});
</script>
<template>
  <div v-if="managed" class="authorization-notice subtle">
    <p>{{ $t('authorization.notice') }}</p>
    <details>
      <summary>{{ $t('authorization.details') }}</summary>
      <p>{{ $t('authorization.storage') }}</p>
      <p>{{ $t('authorization.access') }}</p>
      <p>{{ $t('authorization.control') }}</p>
      <p>{{ $t('authorization.migration') }}</p>
    </details>
  </div>
</template>
<style scoped>
.authorization-notice { line-height:1.6; overflow-wrap:anywhere; }
.authorization-notice p { margin:var(--s-3) 0; }
summary { cursor:pointer; }
</style>
