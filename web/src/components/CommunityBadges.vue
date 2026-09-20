<script setup lang="ts">
import { ref, watch } from "vue";
import { communityRequest } from "@/lib/community";
const props = defineProps<{ handle: string }>();
const badges = ref<string[]>([]);
const level = ref<number | null>(null);
watch(
  () => props.handle,
  async (handle) => {
    badges.value = [];
    level.value = null;
    if (!handle) return;
    try {
      const result = await communityRequest<{ badges: string[]; level?: number }>(
        "/community/members/" + encodeURIComponent(handle),
      );
      if (props.handle === handle) {
        badges.value = result.badges;
        level.value = result.level ?? null;
      }
    } catch {
      /* Public profiles remain available without badges. */
    }
  },
  { immediate: true },
);
</script>
<template>
  <span v-if="badges.length || level !== null" class="community-badges"
    ><span v-if="level !== null">{{ $t('community.level', { level }) }}</span
    ><span v-for="badge in badges" :key="badge">{{
      $t("community.badges." + badge)
    }}</span></span
  >
</template>
<style scoped>
.community-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-2);
}
.community-badges > span {
  background: var(--accent-tint);
  color: var(--accent-text);
  font-size: 12px;
  padding: var(--s-1) var(--s-2);
  border-radius: var(--r-pill);
}
</style>
