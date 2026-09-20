<script setup lang="ts">
import { ref, watch } from "vue";
import { communityRequest } from "@/lib/community";
import CommunityBadgeList from "./CommunityBadgeList.vue";
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
  <CommunityBadgeList :badges="badges" :level="level" />
</template>
<style scoped>
.community-badges { margin-top:var(--s-2); }
</style>
