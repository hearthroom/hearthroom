<script setup lang="ts">
import type { BadgeIcon } from "../../../shared/community-badges";
import { computed } from "vue";
const props = defineProps<{ name: BadgeIcon }>();
/** invite-1…4／spend-1…4 的級數 */
const tier = computed(() => Number(props.name.split("-")[1]) || 0);
</script>
<template>
  <svg :data-icon="name" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <!-- Discord brand mark: Simple Icons, CC0, icons/discord.svg. -->
    <path v-if="name === 'discord'" fill="currentColor" stroke="none" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
    <path v-else-if="name === 'spark'" d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>
    <path v-else-if="name === 'flame'" d="M12 3c1 5-5 6-5 11a5 5 0 0 0 10 0c0-2-1-4-3-6 0 3-2 4-2 4s2-5 0-9Z"/>
    <template v-else-if="name === 'lantern'"><path d="M9.5 6V5a2.5 2.5 0 0 1 5 0v1M7.5 6h9l1.8 4-1.8 9h-9L5.7 10ZM5.7 10h12.6M8 21h8"/><path d="m12 12 1.8 2.5L12 17l-1.8-2.5Z"/></template>
    <path v-else-if="name === 'star'" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>
    <template v-else-if="name === 'crown'"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 11H5ZM6.5 21h11"/><circle cx="12" cy="14" r="1"/></template>
    <template v-else-if="name === 'award'"><circle cx="12" cy="9.5" r="5.7"/><path d="m9.6 9.7 1.6 1.6 3.2-3.4M8.7 14.1 7.4 21l4.6-2.7 4.6 2.7-1.3-6.9"/></template>
    <template v-else-if="name === 'book'"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19a2 2 0 0 0 2 2h13M8 7h7"/></template>
    <!-- 精選作者：一張卡加左下角的實心標籤，和封面上的「精選」標記同源 -->
    <template v-else-if="name === 'featured'"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 8h7"/><rect x="3" y="14" width="11" height="5" rx="1.3" fill="currentColor"/></template>
    <path v-else-if="name === 'heart'" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>
    <template v-else-if="name === 'users'"><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.7"/></template>
    <template v-else-if="name === 'compass'"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/></template>
    <path v-else-if="name === 'bookmark'" d="M7 4h10v17l-5-3.5L7 21Z"/>
    <path v-else-if="name === 'chat'" d="M5 5h14v10H9l-4 4Z"/>
    <template v-else-if="name === 'pen'"><path d="m4 20 4-1 10-10-3-3L5 16Z"/><path d="m13 8 3 3"/></template>
    <template v-else-if="name === 'seedling'"><path d="M12 21v-8"/><path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6ZM12 13c0-3-2-5-6-5 0 3 2 5 6 5Z"/></template>
    <template v-else-if="name === 'clock'"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></template>
    <!-- 元老：內測＝鑰匙、開站＝旗 -->
    <template v-else-if="name === 'veteran-beta'"><circle cx="8" cy="16" r="3.8"/><path d="m10.8 13.2 8.7-8.7M16.2 7.8l2.4 2.4M18.8 5.2l1.8 1.8"/></template>
    <template v-else-if="name === 'veteran-launch'"><path d="M6 21V3"/><path d="M6 4.5h12l-3 4 3 4H6"/></template>
    <!-- 邀請（信封）與消費（寶石）四級：同一主圖逐級疊線，最高級兩側加星點 -->
    <template v-else-if="name.startsWith('invite-')"><rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="m4.6 12 7.4 5.2 7.4-5.2"/><path v-if="tier >= 2" d="M8.5 6.4h7"/><path v-if="tier >= 3" d="M10.5 3.8h3"/><path v-if="tier >= 4" d="M3.6 3.4l.9 1-.9 1-.9-1Zm16.8 0 .9 1-.9 1-.9-1Z" fill="currentColor" stroke-width="1"/></template>
    <template v-else-if="name.startsWith('spend-')"><path d="M7.5 9h9l3.5 3.5L12 21 4 12.5Z"/><path d="M4 12.5h16"/><path v-if="tier >= 2" d="M8.5 6.4h7"/><path v-if="tier >= 3" d="M10.5 3.8h3"/><path v-if="tier >= 4" d="M3.6 3.4l.9 1-.9 1-.9-1Zm16.8 0 .9 1-.9 1-.9-1Z" fill="currentColor" stroke-width="1"/></template>
  </svg>
</template>
<style scoped>
svg { display:block; width:1.25rem; height:1.25rem; flex:none; }
</style>
