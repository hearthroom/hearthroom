<script setup lang="ts">
import { ref, watch } from "vue";
import { publicIdentity } from "@/lib/community-appearance";
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
    let collectionLoaded=false;
    const collectionRequest=communityRequest<BadgeCollection>("/community/members/"+encodeURIComponent(handle)+"/badges").then(collection=>{
      if(props.handle===handle && collection.items){collectionLoaded=true;items.value=collection.items;badges.value=collection.featured;}
    }).catch(()=>{});
    try {
      const result=await publicIdentity(handle);
      if(props.handle===handle){if(!collectionLoaded)badges.value=result.badges;level.value=result.level??null;}
    } catch { /* Public profiles remain available without badges. */ }
    await collectionRequest;
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
