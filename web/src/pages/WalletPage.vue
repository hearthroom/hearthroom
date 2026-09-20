<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { currentProvider, type ProviderId } from '@/lib/provider';
import { pageTitle } from '@/lib/i18n';
import ServiceWallet from '@/components/ServiceWallet.vue';
const session = useSession();
const { t } = useI18n();
const identities = computed(() => session.profile?.identities ?? (session.me ? [{provider: currentProvider(), externalId: session.me.accountNumId}] : []));
onMounted(() => { document.title = pageTitle(t('wallet.title')); });
</script>
<template>
  <div class="page wallet">
    <h1 class="display">{{ $t('wallet.title') }}</h1>
    <ServiceWallet v-for="identity in identities" :key="`${identity.provider}:${identity.externalId}`" :provider="identity.provider as ProviderId" :external-id="identity.externalId" />
  </div>
</template>
<style scoped>
.wallet { max-width:1080px; display:grid; gap:var(--s-6); }
h1 { font-size:1.5rem; }
</style>
