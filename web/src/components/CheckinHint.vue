<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useCheckin } from '@/lib/checkin-store';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { headerOverlaysKey } from '@/lib/site-links';
import { useMediaQuery } from '@/lib/use-media';
const checkin = useCheckin(), session = useSession(), { lp } = useLocalePath();
const overlays = inject(headerOverlaysKey, new Set<symbol>());
const narrow = useMediaQuery('(max-width: 700px)');
const visible = ref(false), reserved = ref(false), used = ref(false);
const placement = ref<Record<string, string>>({});
let timer: ReturnType<typeof setTimeout> | undefined;
const knownPending = computed(() => !!session.me && !!checkin.panel && !checkin.loading && !checkin.error && !checkin.disabled && checkin.canCheckIn);
function close() { visible.value = false; clearTimeout(timer); }
async function locate() {
  await nextTick();
  const header = document.querySelector<HTMLElement>('.header');
  const credits = document.querySelector<HTMLElement>('.acct__credits');
  const avatar = document.querySelector<HTMLElement>('.acct__btn');
  const anchor = credits && credits.getBoundingClientRect().width ? credits : avatar;
  if (!header || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  placement.value = { top: `${header.getBoundingClientRect().bottom + 8}px`, right: `${Math.max(16, innerWidth - rect.right)}px` };
}
watch([knownPending, () => overlays.size], ([pending, open]) => {
  if (!pending || open) { close(); return; }
  if (used.value) return;
  used.value = true; visible.value = true; reserved.value = narrow.value;
  void locate(); timer = setTimeout(close, 8000);
}, { immediate: true });
// Account changes dismiss this page's hint; a prior member's pending state cannot reappear.
watch(() => session.me?.accountNumId, close);
watch(narrow, value => { if (value && visible.value) reserved.value = true; });
window.addEventListener('resize', locate);
onBeforeUnmount(() => { clearTimeout(timer); window.removeEventListener('resize', locate); });
</script>
<template>
  <div class="checkin-hint-slot" :class="{ 'checkin-hint-slot--reserved': reserved }">
    <aside v-if="visible" class="checkin-hint panel" :style="narrow ? undefined : placement" data-checkin-hint>
      <RouterLink :to="lp('/checkin')" @click="close">{{ $t('home.checkinHint') }}</RouterLink>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" :aria-label="$t('home.checkinHintDismiss')" @click="close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </aside>
  </div>
</template>
<style scoped>
.checkin-hint-slot { display: contents; }
.checkin-hint { position: fixed; z-index: 20; width: max-content; max-width: min(240px, calc(100vw - 32px)); display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2); }
.checkin-hint a { min-width: 0; min-height: var(--h-sm); display: flex; align-items: center; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; color: var(--text-2); }
.checkin-hint button { flex: none; width: var(--h-sm); }
.checkin-hint svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.75; }
@media(max-width:700px) {
  .checkin-hint-slot--reserved { display: block; min-height: 56px; position: relative; }
  .checkin-hint { position: absolute; top: var(--s-2); right: var(--s-4); }
}
</style>
