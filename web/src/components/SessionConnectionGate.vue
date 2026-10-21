<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { loginPath } from '@/lib/login-return';

const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const retrying = ref(false);
const blocked = computed(() => route.meta.auth && !session.me && (session.restoreError || retrying.value));
async function retry() {
  if (retrying.value) return;
  const destination = route.fullPath;
  retrying.value = true;
  try {
    await session.retryRestore();
    // Only a confirmed signed-out result starts login; outages keep the URL.
    if (!session.restoreError && !session.me && route.fullPath === destination) {
      await router.replace(lp(loginPath(destination)));
    }
  } finally { retrying.value = false; }
}
</script>

<template>
  <div v-if="blocked" class="notice notice--error" role="alert">
    <span>{{ $t('state.serverBusy') }}</span>
    <button type="button" class="btn btn--lg" :disabled="retrying" :aria-busy="retrying" @click="retry">{{ $t('linked.retry') }}</button>
  </div>
  <slot v-else />
</template>
