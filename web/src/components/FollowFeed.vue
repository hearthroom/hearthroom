<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { libraryRequest } from '@/lib/library';
import { contentLang } from '@/lib/i18n';
import type { CardPage } from '@/lib/types';
import CardGrid from './CardGrid.vue';
const session = useSession();
const { locale, lp } = useLocalePath();
const page = ref<CardPage | null>(null), offset = ref(0), loading = ref(false), failed = ref(false);
let sequence = 0;
async function load() {
  const seq = ++sequence;
  page.value = null; failed.value = false;
  if (!session.me) { loading.value = false; return; }
  loading.value = true;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error('auth');
    const result = await libraryRequest<CardPage>(`feed?offset=${offset.value}&lang=${contentLang(locale.value)}`, token);
    if (seq === sequence) page.value = result;
  } catch { if (seq === sequence) failed.value = true; }
  finally { if (seq === sequence) loading.value = false; }
}
watch([() => session.me, () => session.profile?.showNsfw, () => session.profile?.hiddenTags?.join(','), locale, offset], load, { immediate: true });
</script>
<template>
  <section class="feed" :aria-label="$t('library.feed')">
    <div class="feed__intro"><p class="muted">{{ $t('library.feedHint') }}</p><RouterLink :to="lp('/library?tab=following')">{{ $t('library.manageFollowing') }} →</RouterLink></div>
    <div v-if="!session.me" class="empty panel"><p class="empty__title">{{ $t('library.feedGuest') }}</p><p class="empty__hint muted">{{ $t('library.feedHint') }}</p><RouterLink class="btn" :to="lp('/login?returnTo=' + encodeURIComponent(lp('/?mode=following')))">{{ $t('nav.login') }}</RouterLink></div>
    <div v-else-if="failed" class="notice notice--error" role="alert">{{ $t('library.loadFailed') }} <button class="btn" @click="load">{{ $t('library.retry') }}</button></div>
    <CardGrid v-else :cards="page?.items ?? []" :loading="loading" :empty-title="$t('library.feedEmpty')" :empty-hint="$t('library.followHint')" />
    <nav v-if="page && (offset || page.hasNext)" class="pager" :aria-label="$t('library.feed')"><button class="btn" :disabled="!offset" @click="offset -= 24">{{ $t('pager.prev') }}</button><button class="btn" :disabled="!page.hasNext" @click="offset += 24">{{ $t('pager.next') }}</button></nav>
  </section>
</template>
<style scoped>
.feed { display: grid; gap: var(--s-4); }
.feed__intro { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.feed__intro a { min-height: 44px; display: inline-flex; align-items: center; }
.empty .btn { margin-top: var(--s-4); }
</style>
