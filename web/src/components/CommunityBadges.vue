<script setup lang="ts">
import { ref, watch } from "vue";
import { communityRequest } from "@/lib/community";
import CommunityBadgeList from "./CommunityBadgeList.vue";
import type { BadgeCollection, CollectedBadge } from "../../../shared/community-badges";
const items = ref<CollectedBadge[]>([]);
const props = defineProps<{ handle: string }>();
const badges = ref<string[]>([]);
const level = ref<number | null>(null);
watch(
  () => props.handle,
  async (handle) => {
    badges.value = [];
    items.value = [];
    level.value = null;
    if (!handle) return;
    try {
      const result = await communityRequest<{ badges: string[]; level?: number }>(
        "/community/members/" + encodeURIComponent(handle),
      );
      if (props.handle === handle) {
        badges.value = result.badges;
        level.value = result.level ?? null;
        try {
          const collection=await communityRequest<BadgeCollection>("/community/members/"+encodeURIComponent(handle)+"/badges");
          if(props.handle===handle && collection.items){items.value=collection.items;badges.value=collection.featured;}
        } catch { /* Older deployments still render built-in badges. */ }
      }
    } catch {
      /* Public profiles remain available without badges. */
    }
  },
  { immediate: true },
);
</script>
<template>
  <CommunityBadgeList :badges="badges" :level="level" :items="items" />
</template>
<style scoped>
.community-badges { margin-top:var(--s-2); }
</style>
