<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { libraryRequest } from '@/lib/library';
import { loginPath } from '@/lib/login-return';
import { useI18n } from 'vue-i18n';
const props = withDefaults(defineProps<{ kind: 'favorites' | 'following'; target: string; initialActive?: boolean }>(), { initialActive: undefined });
const emit = defineEmits<{ count: [value: number] }>();
const session = useSession();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const active = ref(false), busy = ref(false), ready = ref(false), error = ref('');
let sequence = 0;
async function load() {
  const seq = ++sequence;
  active.value = false; ready.value = false; error.value = '';
  if (!session.me) { ready.value = true; return; }
  if (props.initialActive !== undefined) { active.value=props.initialActive; ready.value=true; return; }
  try {
    const token = await session.accessToken();
    if (!token) return;
    const result = await libraryRequest<{ active: boolean; count?: number }>(`${props.kind}/${encodeURIComponent(props.target)}`, token);
    if (seq === sequence) { active.value = result.active; ready.value = true; if (result.count !== undefined) emit('count', result.count); }
  } catch { if (seq === sequence) error.value = t('library.loadFailed'); }
}
async function toggle() {
  if (!session.me) { await router.push(lp(loginPath(route.fullPath))); return; }
  if (!ready.value) { await load(); return; }
  busy.value = true; error.value = '';
  const seq = sequence;
  try {
    const token = await session.accessToken();
    if (!token) { await router.push(lp(loginPath(route.fullPath))); return; }
    const result = await libraryRequest<{ active: boolean; count?: number }>(`${props.kind}/${encodeURIComponent(props.target)}`, token, active.value ? 'DELETE' : 'PUT');
    if (seq === sequence) { active.value = result.active; if (result.count !== undefined) emit('count', result.count); }
  } catch { if (seq === sequence) error.value = t('library.saveFailed'); }
  finally { busy.value = false; }
}
watch([() => props.target, () => props.kind, () => props.initialActive, () => session.me], load, { immediate: true });
</script>
<template>
  <div class="library-toggle">
    <button type="button" class="btn" :class="{ 'library-toggle--on': active }" :aria-pressed="active" :title="active ? $t(kind === 'favorites' ? 'library.unsave' : 'library.unfollow') : undefined" :aria-label="active ? $t(kind === 'favorites' ? 'library.unsave' : 'library.unfollow') : undefined" :aria-busy="busy || !ready || undefined" :disabled="busy || (!ready && !error && !!session.me)" @click="toggle">
      {{ $t(!ready && error ? 'library.retry' : kind === 'favorites' ? (active ? 'library.saved' : 'library.save') : (active ? 'library.followed' : 'library.follow')) }}
    </button>
    <p v-if="error" role="alert" class="library-toggle__error">{{ error }}</p>
  </div>
</template>
<style scoped>
.library-toggle { display: grid; gap: var(--s-2); }
.library-toggle .btn { min-height: 44px; min-width: 7rem; }
.library-toggle--on { color: var(--accent-text); background: var(--accent-tint); border-color: var(--accent); }
.library-toggle__error { color: var(--danger); font-size: .875rem; max-width: 22rem; }
</style>
