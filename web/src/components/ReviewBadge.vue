<script setup lang="ts">
import { computed } from 'vue';
import { useReviewer } from '@/lib/review';
const reviewer = useReviewer();
const props = defineProps<{ dot?: boolean; count?: number }>();
const pending = computed(() => props.count ?? reviewer.pending);
</script>
<template><span v-if="reviewer.reviewer && pending > 0" class="review-badge" :class="{'review-badge--dot':dot}" :aria-label="$t('moderation.pending',{n:pending})" :title="$t('moderation.pending',{n:pending})">{{ dot ? '' : pending > 99 ? '99+' : pending }}</span></template>
<style scoped>
.review-badge { display:inline-flex; justify-content:center; align-items:center; min-width:20px; min-height:20px; padding:0 var(--s-1); border-radius:var(--r-pill); background:var(--danger); color:var(--on-danger); font-size:12px; font-weight:700; margin-inline-start:var(--s-1); }
.review-badge--dot { min-width:8px; min-height:8px; padding:0; position:absolute; right:0; top:0; }
</style>
